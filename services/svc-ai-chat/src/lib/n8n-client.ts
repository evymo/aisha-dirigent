/**
 * n8n REST client — push a compiled Flowboard workflow to the n8n engine.
 *
 * The Flowboard "n8n" engine target: a stored FlowGraph is compiled to the
 * `{ name, nodes, connections, settings, meta }` artifact by `compileToN8n`
 * (@aisha/flowboard-core) and created + activated in n8n via its public REST API
 * (`POST /api/v1/workflows`, `POST /api/v1/workflows/{id}/activate`, authenticated
 * with `X-N8N-API-Key`). Mirrors the call shape proven against a live n8n by
 * flowboard-n8n.integration.test.ts.
 *
 * `meta` is sent intentionally: compileToN8n stamps `meta.flowboardNodeMap`
 * (n8n node NAME → flowboard node id), which /flowboard-n8n-callback reads from
 * the execution's workflowData to write per-node automation_step provenance.
 * Dropping it would silently break per-node provenance.
 *
 * Fail-loud (no fallbacks) per the platform rule:
 *   - n8n not configured (no base URL / API key) → throw; the route must NOT
 *     silently fall back to the sandbox engine when the graph PINS n8n.
 *   - the compiled artifact still carries `__REMAP__` credential/workflowId
 *     placeholders → throw; this runtime path has no deploy-time remapper
 *     (deploy-workflows.mjs), so pushing them would create a silently-broken
 *     workflow. (Flowboard design doc §4, "gap #7".)
 *   - n8n returns a non-2xx (create OR activate) → throw with the response body.
 *
 * OWASP A10: every outbound call goes through the SSRF guard (never bare fetch).
 * The configured n8n base host is the trust anchor (operator infrastructure, not
 * user input), so it is included in the guard's host allowlist alongside
 * SSRF_HOST_ALLOWLIST; the guard still enforces scheme + blocks loopback/
 * link-local/metadata IPs after DNS resolution (mesh-internal RFC1918 allowed).
 *
 * @module svc-ai-chat/lib/n8n-client
 */
import type { N8nWorkflow } from '@aisha/flowboard-core';
import { createSsrfGuard, parseHostAllowlist, type SsrfGuard } from '@aisha/security';
import { config } from '../config.js';

/** Raised when the n8n engine cannot be reached/used — callers surface it, never fall back. */
export class N8nEngineError extends Error {
  readonly code: 'not_configured' | 'unresolved_placeholder' | 'push_failed';
  readonly status?: number;
  constructor(
    code: 'not_configured' | 'unresolved_placeholder' | 'push_failed',
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'N8nEngineError';
    this.code = code;
    this.status = status;
  }
}

export interface N8nPushResult {
  /** id assigned by n8n to the created workflow. */
  workflowId: string;
  /** whether n8n reports the workflow active (trigger-bound) after creation. */
  active: boolean;
  /** workflow name as stored in n8n. */
  name: string;
}

/**
 * Detect unresolved `__REMAP__` placeholders anywhere in the compiled artifact.
 * Returns the node names that still carry one (empty array = clean).
 */
export function findUnresolvedPlaceholders(workflow: N8nWorkflow): string[] {
  const offenders: string[] = [];
  for (const node of workflow.nodes) {
    if (JSON.stringify(node.parameters ?? {}).includes('__REMAP__')) {
      offenders.push(node.name);
    }
  }
  return offenders;
}

interface N8nTarget {
  baseUrl: string;
  headers: Record<string, string>;
  guard: SsrfGuard;
}

/** Resolve the configured n8n endpoint + SSRF guard, or throw not_configured. */
function resolveN8nTarget(): N8nTarget {
  const baseUrl = config.n8nBaseUrl.trim().replace(/\/$/, '');
  const apiKey = config.n8nApiKey.trim();
  if (!baseUrl || !apiKey) {
    throw new N8nEngineError(
      'not_configured',
      'n8n engine is not configured (N8N_BASE_URL / N8N_API_KEY missing) — cannot run an n8n-pinned flow',
    );
  }
  let configuredHost: string;
  try {
    configuredHost = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new N8nEngineError('not_configured', `N8N_BASE_URL is not a valid URL: ${baseUrl.slice(0, 80)}`);
  }
  const guard = createSsrfGuard({
    service: 'svc-ai-chat',
    // The configured n8n host is operator config (trust anchor), not user input —
    // it is allowed by definition; SSRF_HOST_ALLOWLIST extends it. The IP guard
    // still blocks loopback/link-local/metadata after DNS resolution.
    hostAllowlist: [...parseHostAllowlist(config.ssrfHostAllowlist), configuredHost],
    allowedSchemes: ['https:', 'http:'],
    allowInternalNetworks: true,
  });
  return {
    baseUrl,
    headers: { 'content-type': 'application/json', 'X-N8N-API-Key': apiKey },
    guard,
  };
}

async function guardedFetch(target: N8nTarget, url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await target.guard.safeFetch(url, init);
  } catch (err) {
    throw new N8nEngineError(
      'push_failed',
      `n8n ${what} failed (network/timeout/SSRF): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Create the compiled workflow in n8n. Fail-loud: throws N8nEngineError on any
 * misconfiguration, unresolved placeholder, or non-2xx response. Does NOT
 * activate — see activateWorkflowInN8n (the route's contract is created+ACTIVE).
 */
export async function pushWorkflowToN8n(workflow: N8nWorkflow): Promise<N8nPushResult> {
  const target = resolveN8nTarget();

  const unresolved = findUnresolvedPlaceholders(workflow);
  if (unresolved.length > 0) {
    throw new N8nEngineError(
      'unresolved_placeholder',
      `compiled workflow still contains __REMAP__ placeholders on node(s): ${unresolved.join(', ')} — refusing to push a broken workflow`,
    );
  }

  if (workflow.nodes.length === 0) {
    throw new N8nEngineError('push_failed', 'compiled workflow has no nodes — nothing to run');
  }

  const res = await guardedFetch(
    target,
    `${target.baseUrl}/api/v1/workflows`,
    {
      method: 'POST',
      headers: target.headers,
      // Full compiled artifact incl. meta.flowboardNodeMap (per-node provenance seam).
      body: JSON.stringify(workflow),
      signal: AbortSignal.timeout(15_000),
    },
    'workflow create',
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new N8nEngineError(
      'push_failed',
      `n8n workflow create returned ${res.status}: ${body.slice(0, 500)}`,
      res.status,
    );
  }

  const created = (await res.json().catch(() => null)) as
    | { id?: string; name?: string; active?: boolean; data?: { id?: string; name?: string; active?: boolean } }
    | null;
  // n8n versions return either the entity or { data: entity }.
  const entity = created?.data ?? created ?? {};
  const workflowId = entity.id;
  if (!workflowId) {
    throw new N8nEngineError('push_failed', 'n8n accepted the workflow but returned no id');
  }

  return {
    workflowId: String(workflowId),
    active: Boolean(entity.active),
    name: entity.name ?? workflow.name,
  };
}

/**
 * Activate a created workflow. A created-but-inactive workflow is a PARTIAL
 * failure of the run contract (200 = created + ACTIVE + provenance) — throws
 * N8nEngineError('push_failed') so the route fails loud instead of reporting a
 * "started" flow that is not live on its trigger.
 */
export async function activateWorkflowInN8n(workflowId: string): Promise<void> {
  const target = resolveN8nTarget();
  const res = await guardedFetch(
    target,
    `${target.baseUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}/activate`,
    { method: 'POST', headers: target.headers, signal: AbortSignal.timeout(15_000) },
    'workflow activate',
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new N8nEngineError(
      'push_failed',
      `n8n workflow activate returned ${res.status} for workflow ${workflowId}: ${body.slice(0, 500)}`,
      res.status,
    );
  }
}
