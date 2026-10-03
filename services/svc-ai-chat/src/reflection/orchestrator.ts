import type {
  Graph,
  GraphNode,
  NodeContext,
  NodeType,
  RunCheckpoint,
  RunRecord,
  WorkflowDefinitionRecord,
} from './types.js';
import { GraphSchema, NodeTypeSchema } from './types.js';
import { NODE_HANDLERS } from './nodes/index.js';
import { acsNodeGateIsEnforcing, acsValidateNodeState } from './acsNodeGate.js';
import { rpc } from './postgrest.js';
import { saveCheckpoint, appendCost, loadRun } from './checkpointer.js';
import { estimateCostUsd } from '../lib/costAggregator.js';
import { loadContext } from './contextLoader.js';
import { reflectionConfig as config } from './config.js';
import { insertRow, updateRow } from './postgrest.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
interface NextNodeResult {
  next_node?: GraphNode | null;
  is_entry?: boolean;
  is_terminal?: boolean;
  candidates?: Array<{ edge: { from: string; to: string; condition?: string }; target_node: GraphNode }>;
  message?: string;
}

/**
 * Evaluate a JS-style condition against the run state.
 * Supports common patterns from graph edges:
 *   - 'score >= 0.85'
 *   - 'iterations < 3'
 *   - 'warnings.length > 0'
 *   - 'approved == true'
 * Conditions reference state keys; unknown identifiers evaluate to undefined.
 */
function evalCondition(condition: string, state: Record<string, unknown>, iteration: number): boolean {
  const scope: Record<string, unknown> = {
    ...state,
    iteration,
    iterations: iteration,
    // Convenience aliases the runner exposes:
    score: state.last_critic_overall,
    warnings:
      ((state.sandbox_result as Record<string, unknown> | undefined)?.warnings as unknown[]) ?? [],
    approved: (state.pending_approval as Record<string, unknown> | undefined)?.approved ?? false,
  };

  try {
    // SECURITY: condition strings come from ai_workflow_definitions.graph which is
    // tenant-editable. We do NOT use eval/Function. Instead, support a tiny grammar.
    return evalGuardedExpression(condition, scope);
  } catch (err) {
    log.safeError(`[runner] condition eval failed: '${condition}'`, err);
    return false;
  }
}

/**
 * Guarded expression evaluator: supports identifiers, dot-paths,
 * .length, comparisons (==, !=, >=, <=, >, <), and AND/OR.
 * No function calls, no member assignment, no template literals.
 */
function evalGuardedExpression(expr: string, scope: Record<string, unknown>): boolean {
  // Normalize spaces
  const e = expr.trim();
  // Split on top-level AND / OR
  const orParts = splitTopLevel(e, ' OR ').length > 1 ? splitTopLevel(e, ' OR ') : splitTopLevel(e, '||');
  if (orParts.length > 1) {
    return orParts.some((p) => evalGuardedExpression(p, scope));
  }
  const andParts = splitTopLevel(e, ' AND ').length > 1 ? splitTopLevel(e, ' AND ') : splitTopLevel(e, '&&');
  if (andParts.length > 1) {
    return andParts.every((p) => evalGuardedExpression(p, scope));
  }

  // Atomic comparison: <left> <op> <right>
  const ops: Array<[string, (a: unknown, b: unknown) => boolean]> = [
    ['>=', (a, b) => (a as number) >= (b as number)],
    ['<=', (a, b) => (a as number) <= (b as number)],
    ['==', (a, b) => a === b],
    ['!=', (a, b) => a !== b],
    ['>', (a, b) => (a as number) > (b as number)],
    ['<', (a, b) => (a as number) < (b as number)],
  ];
  for (const [op, fn] of ops) {
    const idx = indexOfTopLevel(e, op);
    if (idx > 0) {
      const left = e.slice(0, idx).trim();
      const right = e.slice(idx + op.length).trim();
      return fn(resolveValue(left, scope), resolveValue(right, scope));
    }
  }

  // Single boolean value
  const v = resolveValue(e, scope);
  return !!v;
}

function splitTopLevel(s: string, sep: string): string[] {
  // No parentheses support needed yet; simple split
  return s.split(sep).map((x) => x.trim()).filter((x) => x.length > 0);
}

function indexOfTopLevel(s: string, op: string): number {
  return s.indexOf(op);
}

function resolveValue(token: string, scope: Record<string, unknown>): unknown {
  const t = token.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored numeric literal /^-?\d+(\.\d+)?$/ — literal dot disambiguates, linear
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^"[^"]*"$/.test(t) || /^'[^']*'$/.test(t)) return t.slice(1, -1);

  // Dot-path: e.g. 'state.x.y' or 'warnings.length'
  const parts = t.split('.');
  let cur: unknown = scope[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return undefined;
    if (parts[i] === 'length' && (Array.isArray(cur) || typeof cur === 'string')) {
      cur = (cur as { length: number }).length;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[parts[i]];
    } else {
      return undefined;
    }
  }
  return cur;
}

// =========================================================================
// Main execution loop
// =========================================================================

export async function runWorkflow(runId: string): Promise<RunRecord> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return run;
  }
  // Spend admission: a run blocked at creation (awaiting spend approval /
  // denied by policy) must never execute. Approval flips it to 'pending'
  // (approve_task_spend_audited) and the runner is re-invoked via
  // POST /reflect/runs. Pre-existing hole: the old binary budget gate set
  // 'blocked' but this loop executed the run anyway.
  if (run.status === 'blocked') {
    return run;
  }

  // Load workflow definition
  const wfArr = await fetchWorkflow(run.workflow_definition_id);
  if (!wfArr) throw new Error(`Workflow definition ${run.workflow_definition_id} not found`);

  const graphParsed = GraphSchema.safeParse(wfArr.graph);
  if (!graphParsed.success) {
    await saveCheckpoint(runId, emptyCheckpoint(), 'failed');
    throw new Error(`Graph schema invalid: ${graphParsed.error.message}`);
  }
  const graph: Graph = graphParsed.data;
  const workflow: WorkflowDefinitionRecord = { ...wfArr, graph };

  const checkpoint: RunCheckpoint = run.metadata.checkpoint ?? emptyCheckpoint();
  checkpoint.state = checkpoint.state ?? {};

  // Inject task input into state on first node
  if (checkpoint.iteration === 0 && !checkpoint.state.task) {
    checkpoint.state.task = run.metadata.input ?? {};
  }

  // Pre-load context bundle on first iteration
  if (checkpoint.iteration === 0 && !checkpoint.state.composed_context) {
    try {
      const ctx = await loadContext({
        storyId: run.story_id,
        profileSlug:
          ((run.metadata.context as Record<string, unknown>)?.profile_slug as string | undefined) ??
          'learnings_enabled',
        runId,
        query: (run.metadata.input?.description as string) ?? '',
        agentSlug:
          ((run.metadata.input as Record<string, unknown>)?.agent_slug as string | undefined) ??
          config.defaultAgentSlug,
        requesterId: run.actor_user_id,
      });
      checkpoint.state.composed_context = ctx;
    } catch (err) {
      log.safeError(`[runner] compose_context failed for run ${runId}:`, err);
      // Continue — nodes that need context can soft-fail
    }
  }

  await saveCheckpoint(runId, checkpoint, 'running');

  let currentNodeId: string | null = checkpoint.current_node;
  let transitionKey: string | undefined;
  let iteration = checkpoint.iteration;
  // E0.6: per-graph override wins over the env default (LANGGRAPH_MAX_ITERATIONS).
  const maxIter = graph.max_iterations ?? config.maxIterationsPerRun;

  // Initial node = entry node if no checkpoint yet
  if (!currentNodeId) {
    const next = await getNextNode(runId, null, null);
    if (next.next_node) {
      currentNodeId = next.next_node.id;
    } else {
      await saveCheckpoint(runId, checkpoint, 'failed');
      throw new Error('No entry node found in graph');
    }
  }

  while (currentNodeId) {
    iteration++;
    if (iteration > maxIter) {
      log.safeError(`[runner] run ${runId} exceeded max iterations ${maxIter}`, undefined);
      await saveCheckpoint(
        runId,
        { ...checkpoint, current_node: currentNodeId, iteration },
        'failed',
      );
      throw new Error(`Run exceeded max iterations (${maxIter})`);
    }

    const node = graph.nodes.find((n) => n.id === currentNodeId);
    if (!node) {
      await saveCheckpoint(runId, { ...checkpoint, current_node: currentNodeId, iteration }, 'failed');
      throw new Error(`Node ${currentNodeId} referenced in graph but not defined`);
    }

    const nodeType = NodeTypeSchema.parse(node.type);
    const handler = NODE_HANDLERS[nodeType];
    if (!handler) {
      throw new Error(`No handler registered for node_type=${nodeType}`);
    }

    // Insert pending row in ai_workflow_node_runs
    const nodeRunRow = await insertRow('ai_workflow_node_runs', {
      run_id: runId,
      node_id: node.id,
      node_type: node.type,
      status: 'running',
      input_data: { state: redact(checkpoint.state), iteration },
      started_at: new Date().toISOString(),
    });

    const nodeCtx: NodeContext = {
      run,
      workflow,
      node,
      state: checkpoint.state,
      iteration,
    };

    let output;
    try {
      output = await Promise.race([
        handler(nodeCtx),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Node ${node.id} timeout after ${config.defaultNodeTimeoutMs}ms`)),
            config.defaultNodeTimeoutMs,
          ),
        ),
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await updateRow(
        'ai_workflow_node_runs',
        { id: nodeRunRow.id as string },
        {
          status: 'failed',
          error_message: errMsg.slice(0, 500),
          ended_at: new Date().toISOString(),
        },
      );
      await saveCheckpoint(
        runId,
        { ...checkpoint, current_node: currentNodeId, iteration },
        'failed',
      );
      throw err;
    }

    // IP-11 (ACS §4.3): a tot_* handler may merge only validated state (R1) —
    // enums closed, depths consistent, parents existing. Shadow logs, enforce fails
    // the node with the same semantics as a handler exception.
    const acsGate = acsValidateNodeState(nodeType, checkpoint.state);
    if (!acsGate.ok) {
      const acsMsg = `ACS node gate (${nodeType}): ${acsGate.detail ?? 'invalid ToT state'}`;
      if (acsNodeGateIsEnforcing()) {
        await updateRow(
          'ai_workflow_node_runs',
          { id: nodeRunRow.id as string },
          { status: 'failed', error_message: acsMsg.slice(0, 500), ended_at: new Date().toISOString() },
        );
        await saveCheckpoint(runId, { ...checkpoint, current_node: currentNodeId, iteration }, 'failed');
        throw new Error(acsMsg);
      }
      log.safeError(`[runner] ${acsMsg} (shadow — run continues)`, undefined);
    }

    // Persist node run completion
    await updateRow(
      'ai_workflow_node_runs',
      { id: nodeRunRow.id as string },
      {
        status: output.fatal_error ? 'failed' : 'completed',
        output_data: output.output_data,
        transition_key: output.transition_key ?? null,
        ended_at: new Date().toISOString(),
        tokens_input: output.tokens_input ?? 0,
        tokens_output: output.tokens_output ?? 0,
        error_message: output.fatal_error ?? null,
      },
    );

    // Aggregate cost into canonical cost_total_json.total_usd, then enforce the
    // per-story budget at this control-layer boundary. When the node didn't
    // compute an explicit cost_usd, derive it from tokens × model pricing so the
    // board cost — and the budget metering — are real, not zero.
    if (output.tokens_input || output.tokens_output) {
      const tokensIn = output.tokens_input ?? 0;
      const tokensOut = output.tokens_output ?? 0;
      const model = output.output_data?.model as string | undefined;
      // Prompt-cache read/write counts, when the node surfaced them (from the
      // provider usage). Optional — 0 for nodes/providers without prompt caching.
      const cacheRead = (output.output_data?.cache_read_tokens as number | undefined) ?? 0;
      const cacheWrite = (output.output_data?.cache_write_tokens as number | undefined) ?? 0;
      const nodeUsd =
        (output.output_data?.cost_usd as number | undefined) ??
        estimateCostUsd(model ?? '', tokensIn, tokensOut, { read: cacheRead, write: cacheWrite });

      await appendCost(runId, {
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        tokens_cache_read: cacheRead,
        tokens_cache_write: cacheWrite,
        usd: nodeUsd,
        model,
      });

      // Control-layer budget enforcement: meter the actual node spend against the
      // per-story cap + per-user quota. On deny, halt the run gracefully BEFORE
      // the next node (mirrors the interrupt / batch_suspend suspend pattern).
      // Autonomous/service runs (no actor) and infra errors fail open so the
      // platform's own AI is never bricked.
      if (config.budgetEnforcement && run.actor_user_id) {
        try {
          const gate = await rpc<{ allowed?: boolean; reason?: string }>(
            'fn_check_and_consume_ai_budget_audited',
            {
              // Alphabetical param order (RPC convention; mirrors the
              // rpcService/aisha.rpc alphabetical-params gate).
              p_cost: nodeUsd,
              p_story_id: run.story_id,
              p_tokens: tokensIn + tokensOut,
              p_user_id: run.actor_user_id,
            },
          );
          if (gate && gate.allowed === false) {
            log.safeWarn(`[runner] run ${runId} halted by budget (reason=${gate.reason ?? 'unknown'})`);
            checkpoint.current_node = currentNodeId;
            checkpoint.iteration = iteration;
            await saveCheckpoint(runId, checkpoint, 'blocked');
            return await getCurrentRun(runId);
          }
        } catch (err) {
          log.safeWarn(
            `[runner] budget gate error (fail-open): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Merge state patch
    if (output.state_patch) {
      checkpoint.state = { ...checkpoint.state, ...output.state_patch };
    }
    checkpoint.history.push({
      node_id: node.id,
      node_type: nodeType,
      started_at: nodeRunRow.started_at as string,
      ended_at: new Date().toISOString(),
      output_summary: redact(output.output_data) as Record<string, unknown> | undefined,
      transition_key: output.transition_key,
    });

    if (output.fatal_error) {
      await saveCheckpoint(
        runId,
        { ...checkpoint, current_node: currentNodeId, iteration },
        'failed',
      );
      throw new Error(`Fatal error in node ${node.id}: ${output.fatal_error}`);
    }

    if (output.interrupt) {
      checkpoint.current_node = currentNodeId; // resume here
      checkpoint.iteration = iteration;
      await saveCheckpoint(runId, checkpoint, 'waiting_human');
      return await getCurrentRun(runId);
    }

    if (output.batch_suspend) {
      // Provider batch API is in-flight (Anthropic Message Batches / OpenAI
      // Batch API). Suspend the run; n8n WF_BATCH_POLLER updates ai_batch_jobs
      // status as the batch progresses, and (future) WF_BATCH_RESUMER will
      // re-invoke runWorkflow(runId) once results are persisted into state.
      // Until that resumer is wired, run stays in 'waiting_batch' indefinitely
      // and operator can resume manually via resumeWorkflow() after batch lands.
      checkpoint.current_node = currentNodeId;
      checkpoint.iteration = iteration;
      await saveCheckpoint(runId, checkpoint, 'waiting_batch');
      return await getCurrentRun(runId);
    }

    transitionKey = output.transition_key;
    checkpoint.iteration = iteration;
    checkpoint.current_node = currentNodeId;
    await saveCheckpoint(runId, checkpoint);

    // Determine next node
    const next = await getNextNode(runId, currentNodeId, transitionKey ?? null);
    if (next.is_terminal || !next.candidates) {
      currentNodeId = null;
      break;
    }

    // Evaluate edge conditions to pick the matching one
    let chosen: GraphNode | null = null;
    for (const cand of next.candidates) {
      if (!cand.edge.condition) {
        // Default fallthrough — use only if no conditional matched
        if (!chosen) chosen = cand.target_node;
        continue;
      }
      const matches = evalCondition(cand.edge.condition, checkpoint.state, iteration);
      if (matches) {
        chosen = cand.target_node;
        break;
      }
    }

    if (!chosen) {
      // No edges matched and no default → terminal
      currentNodeId = null;
      break;
    }

    currentNodeId = chosen.id;
  }

  checkpoint.current_node = null;
  await saveCheckpoint(runId, checkpoint, 'completed');
  return await getCurrentRun(runId);
}

export async function resumeAfterApproval(
  runId: string,
  approved: boolean,
  note?: string,
): Promise<RunRecord> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== 'waiting_human') {
    throw new Error(`Cannot resume run ${runId}: status is ${run.status}, expected waiting_human`);
  }

  const checkpoint = run.metadata.checkpoint ?? emptyCheckpoint();
  checkpoint.state.pending_approval = {
    ...(checkpoint.state.pending_approval as Record<string, unknown> ?? {}),
    approved,
    note,
    decided_at: new Date().toISOString(),
  };

  await saveCheckpoint(runId, checkpoint, approved ? 'running' : 'cancelled');

  if (!approved) {
    return await getCurrentRun(runId);
  }
  return await runWorkflow(runId);
}

/**
 * Resume a run that was suspended by the generator's batch dispatch
 * (status='waiting_batch'). Counterpart to resumeAfterApproval but for
 * the batch flow.
 *
 * Sequence:
 *   1. persist_batch_result_and_resume RPC has already (a) merged batch_result
 *      + last_generation into ai_runs.metadata.checkpoint.state, (b) flipped
 *      status to 'running', (c) audited the event.
 *   2. This function just re-invokes runWorkflow(runId) so the orchestrator
 *      picks up from the saved checkpoint and continues past the generator
 *      node (which now has last_generation in state).
 *
 * The HTTP route POST /reflect/runs/:id/resume-batch is the public entry —
 * called by WF_BATCH_RESUMER after it normalized the provider's batch
 * payload and called the persist RPC. Idempotent: if status is already
 * 'completed' or 'running', this is effectively a no-op (runWorkflow's
 * early-return handles terminal states).
 */
export async function resumeAfterBatch(runId: string): Promise<RunRecord> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  // Allow 'running' too — persist_batch_result_and_resume already flipped
  // status, so by the time we get here it's running. If someone calls this
  // directly without going through the RPC, waiting_batch is also valid.
  if (run.status !== 'running' && run.status !== 'waiting_batch') {
    throw new Error(
      `Cannot resume run ${runId} via batch path: status is ${run.status}, expected running or waiting_batch`,
    );
  }

  return await runWorkflow(runId);
}

// =========================================================================
// Helpers
// =========================================================================

async function getNextNode(
  runId: string,
  lastNodeId: string | null,
  transitionKey: string | null,
): Promise<NextNodeResult> {
  return rpc<NextNodeResult>('fn_get_next_graph_node', {
    p_run_id: runId,
    p_last_node_id: lastNodeId,
    p_transition_key: transitionKey,
  });
}

async function getCurrentRun(runId: string): Promise<RunRecord> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`Run ${runId} disappeared`);
  return run;
}

async function fetchWorkflow(
  id: string,
): Promise<WorkflowDefinitionRecord | null> {
  const res = await fetch(
    `${config.postgrestUrl}/ai_workflow_definitions?id=eq.${encodeURIComponent(id)}&select=*`,
    {
      headers: {
        Authorization: `Bearer ${config.postgrestServiceToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (!res.ok) return null;
  const arr = (await res.json()) as WorkflowDefinitionRecord[];
  return arr[0] ?? null;
}

function emptyCheckpoint(): RunCheckpoint {
  return { current_node: null, iteration: 0, history: [], state: {} };
}

function redact(obj: unknown): unknown {
  // For now, output_data + state are stored as-is. Future: strip embeddings,
  // long blobs, secrets. Keep this hook to enforce the policy in one place.
  return obj;
}
