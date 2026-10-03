/**
 * E3 runtime axis — REAL-environment integration test.
 *
 * Drives the REAL clow-resolution + runtime-dispatch nodes against a REAL pg17 +
 * REAL PostgREST. Nothing in the DB path is mocked: fn_resolve_runtime (runtime
 * derivation), fn_admit_clow (admission), aisha_resolve_clow_backend (model
 * resolution) and the ai_decisions journal all run for real. ONLY the external LLM
 * (unifiedChat) is stubbed — we never hit a paid provider from a test.
 *
 * This is the end-to-end proof that the OpenClaw/Hermes runtime axis is functional:
 * the executor runtime + model are DERIVED from the live registry, then the work is
 * actually dispatched through the RuntimeAdapter and the dispatch is journaled.
 *
 * Run: npm run test:reflection:runtime-fullenv  (skips offline — no POSTGREST_URL).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { NodeContext, NodeHandler, RunRecord, WorkflowDefinitionRecord, GraphNode } from '../../reflection/types.js';

// Stub ONLY the external LLM. The decision journal + postgrest + adapters stay real.
const { unifiedChat } = vi.hoisted(() => ({ unifiedChat: vi.fn() }));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
// Real resolveProvider + selectServiceableSlugs; only the network call is stubbed.
vi.mock('../../lib/llmRouter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llmRouter.js')>();
  return { ...actual, unifiedChat };
});

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${BASE}/${pathAndQuery}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${pathAndQuery} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// Service-role POST (the probe RPCs are service-role only).
async function callRpc<T = unknown>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST rpc/${fn} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

RUN('E3 runtime axis — real DB derive runtime+model, dispatch, journal', () => {
  let openclawResolveClow: NodeHandler;
  let runtimeDispatch: NodeHandler;
  let rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
  let runWorkflow: (runId: string) => Promise<{ status: string }>;
  let runId: string;

  beforeAll(async () => {
    ({ openclawResolveClow } = await import('../../reflection/nodes/openclaw_resolve_clow.js'));
    ({ runtimeDispatch } = await import('../../reflection/nodes/runtime_dispatch.js'));
    ({ rpc } = await import('../../reflection/postgrest.js'));
    ({ runWorkflow } = await import('../../reflection/orchestrator.js'));
    unifiedChat.mockResolvedValue({
      text: 'executed via direct_llm', model: 'stub', provider: 'openai', usage: { inputTokens: 2, outputTokens: 3 },
    });
    // A real run so journalDispatch's ai_decisions row satisfies its FK.
    const def = await q<Array<{ id: string }>>('ai_workflow_definitions?is_active=eq.true&select=id&limit=1');
    runId = (await rpc('fn_create_workflow_run', {
      p_workflow_definition_id: def[0].id,
      p_input: { description: 'execute a simple task' },
    })) as string;
  });

  function ctx(state: Record<string, unknown>): NodeContext {
    const run = {
      id: runId, kind: 'reflection', story_id: null, actor_user_id: null, status: 'running',
      workflow_definition_id: '00000000-0000-0000-0000-000000000000',
      metadata: { context: {}, input: { description: 'execute a simple task' } }, cost_total_json: {},
    } as unknown as RunRecord;
    return {
      run,
      workflow: { graph: { entry: '', nodes: [], edges: [] } } as unknown as WorkflowDefinitionRecord,
      node: { id: 'n', type: 'openclaw_resolve_clow' as never, config: { constraints: { purpose: 'execute a simple task' } } } as GraphNode,
      state,
      iteration: 1,
    };
  }

  it('openclaw_resolve_clow DERIVES a real runtime + resolves a real model from the live registry', async () => {
    const out = await openclawResolveClow(ctx({ current_clow: { purpose: 'execute a simple task' } }));
    expect(out.fatal_error, out.fatal_error).toBeUndefined();
    // Runtime came from fn_resolve_runtime over ai_runtime_registry — a real kind.
    expect(['direct_llm', 'openclaw', 'hermes', 'cli', 'workflow']).toContain(out.state_patch!.derived_runtime);
    // Model came from aisha_resolve_clow_backend over the provider/model registry.
    expect(out.state_patch!.clow_backend).toBeTruthy();
  });

  it('runtime_dispatch EXECUTES through the RuntimeAdapter and journals the dispatch (I1, real ai_decisions)', async () => {
    const resolveOut = await openclawResolveClow(ctx({ current_clow: { purpose: 'execute a simple task' } }));
    const decBefore = (await q<Array<unknown>>('ai_decisions?select=id')).length;

    const dispatchOut = await runtimeDispatch(ctx({ ...resolveOut.state_patch, dispatch_input: 'do the work' }));
    expect(dispatchOut.fatal_error, dispatchOut.fatal_error).toBeUndefined();
    expect(dispatchOut.transition_key).toBe('executed');
    expect(dispatchOut.state_patch!.runtime_output).toBe('executed via direct_llm');

    // The direct_llm dispatch minted a real ai_decisions row (AISHA authority).
    const decAfter = (await q<Array<unknown>>('ai_decisions?select=id')).length;
    expect(decAfter).toBeGreaterThan(decBefore);
  });

  it('the REAL orchestrator drives the seeded runtime-execute graph end-to-end (resolve_clow → dispatch → completed)', async () => {
    const def = await q<Array<{ id: string; is_active: boolean }>>(
      'ai_workflow_definitions?name=eq.runtime-execute&select=id,is_active',
    );
    expect(def, 'runtime-execute graph not seeded').toHaveLength(1);
    expect(def[0].is_active).toBe(true);

    const rid = (await rpc('fn_create_workflow_run', {
      p_workflow_definition_id: def[0].id,
      p_input: { description: 'execute a simple task' },
    })) as string;
    const decBefore = (await q<Array<unknown>>('ai_decisions?select=id')).length;

    const result = await runWorkflow(rid);
    expect(result.status).toBe('completed');

    // Both executor nodes actually ran (real ai_workflow_node_runs).
    const nodeRuns = await q<Array<{ node_type: string }>>(
      `ai_workflow_node_runs?run_id=eq.${rid}&select=node_type`,
    );
    const types = new Set(nodeRuns.map((r) => r.node_type));
    expect(types.has('openclaw_resolve_clow'), 'resolve_clow did not run').toBe(true);
    expect(types.has('runtime_dispatch'), 'runtime_dispatch did not run').toBe(true);

    // The orchestrated dispatch journaled a decision too (I1 across the real run).
    const decAfter = (await q<Array<unknown>>('ai_decisions?select=id')).length;
    expect(decAfter).toBeGreaterThan(decBefore);
  });

  it('the health probe closes the loop: a probed-down runtime is excluded at RESOLVE, degraded stays usable', async () => {
    // openclaw is the only runtime serving write+internet+tools.
    const clow = { needs_write: true, needs_internet: true, needs_tools: true };
    const before = await callRpc<{ runtime?: string }>('fn_resolve_runtime', { p_clow: clow });
    expect(before.runtime).toBe('openclaw');

    // Probe records DOWN → the resolver must exclude it (fail-loud at RESOLVE, not dispatch).
    await callRpc('record_runtime_health_result', { p_slug: 'openclaw', p_status: 'down', p_latency_ms: null, p_detail: 'test: refused' });
    const down = await callRpc<{ resolved?: boolean }>('fn_resolve_runtime', { p_clow: clow });
    expect(down.resolved).toBe(false);

    // DEGRADED (reachable but slow) stays usable — the probe only excludes 'down'.
    await callRpc('record_runtime_health_result', { p_slug: 'openclaw', p_status: 'degraded', p_latency_ms: 3200, p_detail: 'slow' });
    const degraded = await callRpc<{ runtime?: string }>('fn_resolve_runtime', { p_clow: clow });
    expect(degraded.runtime).toBe('openclaw');

    // Restore healthy (failure counter resets) so re-runs see a clean registry.
    const healthy = await callRpc<{ to_status?: string }>('record_runtime_health_result', { p_slug: 'openclaw', p_status: 'healthy', p_latency_ms: 5, p_detail: null });
    expect(healthy.to_status).toBe('healthy');
    const after = await callRpc<{ runtime?: string }>('fn_resolve_runtime', { p_clow: clow });
    expect(after.runtime).toBe('openclaw');
  });

  it('the classifier closes the static-link gap: a write/agentic task derives needs → openclaw is selected (not direct_llm)', async () => {
    // derive_clow_needs (the single producer) turns task semantics into clow needs…
    const needs = await callRpc<{ needs_write?: boolean }>('derive_clow_needs', {
      p_task: { description: 'implement and deploy the new auth flow' },
    });
    expect(needs.needs_write).toBe(true);
    // …and those needs make fn_resolve_runtime pick openclaw instead of direct_llm.
    const resolved = await callRpc<{ runtime?: string }>('fn_resolve_runtime', { p_clow: { purpose: 'x', ...needs } });
    expect(resolved.runtime).toBe('openclaw');

    // A plain reasoning task derives no needs → stays direct_llm (the universal default).
    const plain = await callRpc<{ has_capability_need?: boolean }>('derive_clow_needs', {
      p_task: { description: 'explain the tradeoffs of approach X' },
    });
    expect(plain.has_capability_need).toBe(false);
    const plainRt = await callRpc<{ runtime?: string }>('fn_resolve_runtime', { p_clow: { purpose: 'x', ...plain } });
    expect(plainRt.runtime).toBe('direct_llm');
  });

  it('the chooser routes a capability task to the runtime-execute graph; a plain task stays direct', async () => {
    const writeTask = await callRpc<{ graph_slug?: string | null }>('aisha_choose_execution_strategy', {
      p_task: { description: 'implement and build the feature' },
    });
    expect(writeTask.graph_slug).toBe('runtime-execute');

    const plainTask = await callRpc<{ graph_slug?: string | null }>('aisha_choose_execution_strategy', {
      p_task: { description: 'explain the tradeoffs of approach X' },
    });
    expect(plainTask.graph_slug).toBeNull();
  });

  it('the workbench is a registered runtime surface but DISABLED — first-class, executor adapter pending (PR-F)', async () => {
    const res = await fetch(`${BASE}/ai_runtime_registry?slug=eq.workbench&select=slug,runtime_kind,is_enabled`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const rows = (await res.json()) as Array<{ slug: string; runtime_kind: string; is_enabled: boolean }>;
    expect(rows.length, 'workbench runtime must be registered (the enum + seed accept it)').toBe(1);
    expect(rows[0].runtime_kind).toBe('workbench');
    // Disabled by design: the workbench CONTRIBUTES models today; it does not yet
    // execute via this axis, so resolution must never pick it.
    expect(rows[0].is_enabled, 'workbench stays disabled until an execution adapter ships').toBe(false);
  });

  it('GAP A: the workflow runtime is NEVER auto-derived as a dispatch executor (is_in_process_executor=false, column-driven)', async () => {
    // 'workflow' is seeded enabled+healthy and a (write+internet, no-tools) clow matches
    // its declared caps — but it has NO RuntimeAdapter in executeViaRuntime, so it declares
    // is_in_process_executor=false. fn_resolve_runtime filters on that SELF-DECLARED flag
    // (capability-availability), NOT a hardcoded NOT IN list — so workflow can never be the
    // derived executor (which would THROW "No RuntimeAdapter"); it fails loud instead.

    // (1) The exclusion is column-driven AND stays in lock-step with RUNTIME_ADAPTERS
    // (DD-2 drift gate): is_in_process_executor MUST equal "this kind has a RuntimeAdapter",
    // DERIVED from the live adapter registry — not hand-kept aligned by a prose coupling
    // comment. is_in_process_executor is STATIC (a kind has an adapter or not), so it's
    // seed-declared + gated here, unlike the DYNAMIC is_enabled/adapter_health that
    // selfRegister reconciles at boot. cli is per-slug (a kind-keyed adapter under-specifies
    // cli:<slug>, fn_resolve_runtime.sql:59-60), so it is excluded from this kind-level check.
    const { RUNTIME_ADAPTERS } = await import('../../reflection/runtime/adapters.js');
    const adapterKinds = new Set(Object.keys(RUNTIME_ADAPTERS));
    const rows = await q<Array<{ runtime_kind: string; slug: string; is_in_process_executor: boolean }>>(
      `ai_runtime_registry?runtime_kind=neq.cli&select=runtime_kind,slug,is_in_process_executor`,
    );
    expect(rows.length, 'expected the seeded non-cli runtimes').toBeGreaterThan(0);
    for (const r of rows) {
      expect(
        r.is_in_process_executor,
        `${r.slug}: is_in_process_executor must equal RUNTIME_ADAPTERS membership (kind '${r.runtime_kind}' in adapters = ${adapterKinds.has(r.runtime_kind)}) — seed/adapter drift`,
      ).toBe(adapterKinds.has(r.runtime_kind));
    }

    // (2) The behavioral consequence: even as the SOLE capability match, workflow is never derived.
    const clow = { purpose: 'wf', needs_write: true, needs_internet: true, needs_tools: false };
    // Down the in-process executors that also satisfy the clow so that, were 'workflow'
    // derivable, it would be the SOLE remaining match.
    await callRpc('record_runtime_health_result', { p_slug: 'openclaw', p_status: 'down', p_latency_ms: null, p_detail: 'test: gap-A isolate workflow' });
    await callRpc('record_runtime_health_result', { p_slug: 'hermes', p_status: 'down', p_latency_ms: null, p_detail: 'test: gap-A isolate workflow' });
    try {
      const res = await callRpc<{ runtime?: string; resolved?: boolean }>('fn_resolve_runtime', { p_clow: clow });
      expect(res.runtime, "workflow must never be auto-derived as an executor").not.toBe('workflow');
      expect(res.resolved, 'no in-process executor remains → fail loud (not a workflow that throws at dispatch)').toBe(false);
    } finally {
      // Restore healthy so re-runs (and later tests) see a clean registry.
      await callRpc('record_runtime_health_result', { p_slug: 'openclaw', p_status: 'healthy', p_latency_ms: 5, p_detail: null });
      await callRpc('record_runtime_health_result', { p_slug: 'hermes', p_status: 'healthy', p_latency_ms: 5, p_detail: null });
    }
  });

  it('GAP F: an admission DENY journals an ai_decisions audit row (resolution_source=admission_deny)', async () => {
    // A high estimate trips the spend deny threshold → openclaw_resolve_clow BLOCKS. The
    // verdict must also land in ai_decisions (resolution_source=admission_deny), not just
    // reflection state — denied/asked tasks previously left NO journal row at all.
    const denyCtx = ctx({});
    (denyCtx.run.metadata.context as Record<string, unknown>).estimate_usd = 75;
    const out = await openclawResolveClow(denyCtx);
    expect(out.transition_key, `expected admission_denied, got ${JSON.stringify(out.output_data)}`).toBe('admission_denied');

    const rows = await q<Array<{ resolution_source: string; admission_verdict: string }>>(
      `ai_decisions?run_id=eq.${runId}&resolution_source=eq.admission_deny&select=resolution_source,admission_verdict&limit=5`,
    );
    expect(rows.length, 'an admission deny must leave an ai_decisions audit row').toBeGreaterThan(0);
    expect(rows[0].admission_verdict).toBe('deny');
  });
});
