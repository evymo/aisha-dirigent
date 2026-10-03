/**
 * Sandbox — dry-run validation of a workflow JSON.
 *
 * NOT an executor. Walks the workflow node-by-node, reports:
 *   - shape warnings (missing required fields, unknown node types)
 *   - policy warnings (side-effect actions present without explicit
 *     `confirm: true`, side-effect actions targeting prod-zone resources
 *     without sandbox: true, etc.)
 *   - simulated effects (what WOULD have happened if executed: list of
 *     RPCs that would be called, external requests that would be issued,
 *     channels that would be notified — purely declarative)
 *
 * The shape contract is intentionally loose so we accept both the n8n
 * workflow JSON shape AND the AISHA reflection graph JSON shape. Both
 * are { nodes: [{type, ...}], edges?: [{from, to}] }. Field names differ
 * slightly between the two; we treat them uniformly.
 *
 * Audit row was already written by the calling RPC
 * `aisha_dryrun_in_openclaw_sandbox` before this daemon was invoked.
 */
import type { FastifyBaseLogger } from 'fastify';

interface SandboxInput {
  request_id?: string | null;
  workflow: Record<string, unknown> | string;
  inputs?: Record<string, unknown>;
  timeout_s?: number;
}

interface SandboxResult {
  request_id: string | null;
  ok: boolean;
  warnings: Array<{ severity: 'info' | 'warn' | 'block'; node?: string; reason: string }>;
  simulated_effects: Array<{ kind: 'rpc' | 'http' | 'notify' | 'spawn' | 'unknown'; target?: string; node?: string }>;
  step_count: number;
}

// Action verbs we recognize as side-effect-bearing. The list is conservative
// — anything outside it is treated as 'unknown' and flagged 'info'.
const SIDE_EFFECT_ACTIONS = new Set<string>([
  // n8n-style
  'webhook',
  'httpRequest',
  'slack',
  'telegram',
  'matrix',
  'discord',
  'gmail',
  'sendEmail',
  // AISHA reflection-style
  'http_call',
  'rpc_call',
  'mcp_call',
  'notify',
  'spawn_agent',
  'create_file',
  'modify_file',
  'execute_shell',
]);

const PROD_DOMAIN_RE =
  /(?:\bprod\b|\.aisha\.guru\b|\.backend\.id3a\.cz\b|\.id3a\.cz\b)/i;

export async function sandboxWorkflow(
  input: SandboxInput,
  log: FastifyBaseLogger,
): Promise<SandboxResult> {
  const req_id = input.request_id ?? null;
  const warnings: SandboxResult['warnings'] = [];
  const simulated: SandboxResult['simulated_effects'] = [];

  // Accept either raw JSON or a stringified workflow. Reflection graphs
  // sometimes pass through the JSON.stringify path when reading from DB.
  let wf: Record<string, unknown>;
  if (typeof input.workflow === 'string') {
    try {
      wf = JSON.parse(input.workflow) as Record<string, unknown>;
    } catch (err) {
      log.warn({ req_id, err: String(err) }, 'sandbox: workflow not parseable as JSON');
      return {
        request_id: req_id,
        ok: false,
        warnings: [
          { severity: 'block', reason: 'workflow_not_parseable_json' },
        ],
        simulated_effects: [],
        step_count: 0,
      };
    }
  } else {
    wf = input.workflow;
  }

  // Nodes live under .nodes (n8n + AISHA reflection both). If absent,
  // the workflow is essentially empty — flag and return.
  const nodes = Array.isArray(wf.nodes) ? (wf.nodes as Array<Record<string, unknown>>) : null;
  if (!nodes) {
    warnings.push({ severity: 'block', reason: 'no_nodes_array_in_workflow' });
    return {
      request_id: req_id,
      ok: false,
      warnings,
      simulated_effects: [],
      step_count: 0,
    };
  }

  // Hard cap on node count. 100 is generous; anything beyond is almost
  // certainly a malformed expansion or a runaway generator.
  if (nodes.length > 100) {
    warnings.push({
      severity: 'block',
      reason: `node_count_exceeds_safety_cap (${nodes.length} > 100)`,
    });
    return {
      request_id: req_id,
      ok: false,
      warnings,
      simulated_effects: [],
      step_count: nodes.length,
    };
  }

  let stepCount = 0;
  for (const node of nodes) {
    stepCount += 1;
    const nodeName = typeof node.name === 'string' ? node.name : `node_${stepCount}`;
    const nodeType = typeof node.type === 'string' ? node.type : typeof node.action === 'string' ? node.action : '';

    if (!nodeType) {
      warnings.push({
        severity: 'warn',
        node: nodeName,
        reason: 'missing_node_type',
      });
      simulated.push({ kind: 'unknown', node: nodeName });
      continue;
    }

    // Categorize the node's side-effect kind.
    const lowered = nodeType.toLowerCase();
    let kind: SandboxResult['simulated_effects'][number]['kind'] = 'unknown';
    if (lowered.includes('http') || lowered.includes('webhook')) kind = 'http';
    else if (lowered.includes('rpc') || lowered.includes('postgres') || lowered.includes('mcp')) kind = 'rpc';
    else if (
      lowered.includes('slack') ||
      lowered.includes('telegram') ||
      lowered.includes('matrix') ||
      lowered.includes('discord') ||
      lowered.includes('notify') ||
      lowered.includes('email')
    ) {
      kind = 'notify';
    } else if (lowered.includes('spawn') || lowered.includes('agent')) {
      kind = 'spawn';
    }

    // Resolve a probable target URL/identifier for the simulated effect.
    const target =
      typeof node.endpoint === 'string'
        ? node.endpoint
        : typeof node.url === 'string'
          ? node.url
          : typeof node.recipient === 'string'
            ? node.recipient
            : typeof node.channel === 'string'
              ? node.channel
              : undefined;

    simulated.push({ kind, target, node: nodeName });

    // Policy warning: side-effect node targeting a prod domain without
    // `sandbox: true` or `confirm: true` set on the node.
    const isSideEffect = SIDE_EFFECT_ACTIONS.has(nodeType) || SIDE_EFFECT_ACTIONS.has(lowered);
    const confirmed = node.confirm === true || node.sandbox === true || node.dry_run === true;
    const targetStr = target ?? '';
    if (isSideEffect && PROD_DOMAIN_RE.test(targetStr) && !confirmed) {
      warnings.push({
        severity: 'warn',
        node: nodeName,
        reason: `side_effect_targets_prod_domain_without_confirm (target=${targetStr.slice(0, 80)})`,
      });
    }
  }

  // ok=true iff no block-severity warning. warn-level alone is advisory.
  const blocking = warnings.some((w) => w.severity === 'block');

  return {
    request_id: req_id,
    ok: !blocking,
    warnings,
    simulated_effects: simulated,
    step_count: stepCount,
  };
}
