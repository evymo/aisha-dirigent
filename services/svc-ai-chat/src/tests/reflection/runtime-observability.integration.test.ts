/**
 * E3 OBSERVABILITY — acceptance tests (written BEFORE the implementation, TDD).
 *
 * The audit found the reflection path (which hosts the E3 runtime/executor axis) is
 * a tracing blind spot: runWorkflow never creates a tracer, so executor dispatch
 * never reaches ai_trace_events / Langfuse — unlike the chat route which traces
 * every LLM call. These tests DEFINE "observable + correct": a reflection run must
 * emit ai_trace_events that carry the runtime/executor identity (decision_id ←
 * ai_decisions, model_id, backend_kind/runtime).
 *
 * RED until #3 (tracer at the orchestrator boundary + span the runtime dispatch).
 * Run: npm run test:reflection:fullenv.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const { unifiedChat } = vi.hoisted(() => ({ unifiedChat: vi.fn() }));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
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

type TraceRow = { id: string; event_type: string; agent_slug: string | null; operation: string | null; backend_kind: string | null; model_id: string | null; decision_id: string | null };

RUN('E3 observability — reflection runWorkflow is traced (acceptance, RED until #3)', () => {
  let runWorkflow: (runId: string) => Promise<{ status: string }>;
  let defId: string;

  beforeAll(async () => {
    ({ runWorkflow } = await import('../../reflection/orchestrator.js'));
    unifiedChat.mockResolvedValue({ text: 'done', model: 'stub', provider: 'openai', usage: { inputTokens: 2, outputTokens: 3 } });
    const def = await q<Array<{ id: string }>>('ai_workflow_definitions?name=eq.runtime-execute&select=id');
    defId = def[0].id;
  });

  async function runOnce(): Promise<string> {
    const rid = (await callRpc<string>('fn_create_workflow_run', {
      p_workflow_definition_id: defId,
      p_input: { description: 'execute a simple task' },
    }));
    await runWorkflow(rid);
    return rid;
  }

  it('A: runWorkflow emits ai_trace_events for the run (reflection path no longer a blind spot)', async () => {
    const rid = await runOnce();
    const traces = await q<TraceRow[]>(
      `ai_trace_events?run_id=eq.${rid}&select=id,event_type,agent_slug,operation,backend_kind,model_id,decision_id`,
    );
    expect(traces.length, 'no ai_trace_events emitted for the reflection run — orchestrator has no tracer').toBeGreaterThan(0);
  });

  it('B: the runtime dispatch is traced — a span carries the executor identity (runtime/model/decision_id)', async () => {
    const rid = await runOnce();
    const traces = await q<TraceRow[]>(
      `ai_trace_events?run_id=eq.${rid}&select=id,event_type,agent_slug,operation,backend_kind,model_id,decision_id`,
    );
    // The executor execution (direct_llm via the RuntimeAdapter) must produce a span
    // that threads the journaled decision_id (the I1 ai_decisions row) — read-side
    // transparency the audit found broken for the reflection path.
    expect(
      traces.some((t) => t.decision_id != null || t.backend_kind != null || t.model_id != null),
      'no trace event carries runtime/executor identity (decision_id/backend_kind/model_id)',
    ).toBe(true);
  });
});
