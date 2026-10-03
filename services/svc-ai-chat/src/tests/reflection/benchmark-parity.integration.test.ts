/**
 * Benchmark parity — REAL-environment integration. The single biggest risk for the
 * benchmark is task_type DRIFT: if the runner records a task_type the resolver doesn't
 * query, the LEFT JOIN falls to the 0.5 default and the benchmark is a silent no-op.
 * This proves the chain end to end:
 *   1. record_model_benchmark has REPLACE semantics (one current row per model+task_type).
 *   2. a 'chat' benchmark actually MOVES the resolver's score for that model — i.e.
 *      task_type='chat' (what the runner writes) === v_task_kind (what the resolver joins
 *      on, default 'chat'). A 0.0 vs 1.0 benchmark must produce a lower vs higher score.
 *
 * Run: npm run test:reflection:fullenv (skips offline).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(p: string): Promise<T> {
  const res = await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
async function callRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`POST rpc/${fn} → ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

RUN('benchmark parity — task_type=chat feeds the resolver, replace semantics', () => {
  it('record_model_benchmark REPLACES → one current row per (model, task_type)', async () => {
    await callRpc('upsert_discovered_model', { p_model_id: 'bench-replace-x', p_provider: 'openai' });
    const id = (await q<Array<{ id: string }>>('ai_model_registry?model_id=eq.bench-replace-x&select=id'))[0].id;

    await callRpc('record_model_benchmark', { p_model_registry_id: id, p_task_type: 'chat', p_overall: 0.3 });
    await callRpc('record_model_benchmark', { p_model_registry_id: id, p_task_type: 'chat', p_overall: 0.9 });

    const rows = await q<Array<{ overall_score: number }>>(
      `ai_model_benchmarks?model_registry_id=eq.${id}&task_type=eq.chat&select=overall_score`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].overall_score)).toBe(0.9);
  });

  it('a chat benchmark MOVES the resolver score (parity: task_type=chat === v_task_kind)', async () => {
    // Use a model the resolver ALREADY ranks (a real seeded candidate), so candidacy
    // never depends on a freshly-discovered model's provider wiring.
    const resolve = () =>
      callRpc<{ resolved: boolean; candidates?: Array<{ model_id: string; score: string }> }>(
        'aisha_resolve_clow_backend',
        { p_clow: { purpose: 'a simple chat task', task_kind: 'chat' } },
      );

    const first = await resolve();
    expect(first.resolved, JSON.stringify(first)).toBe(true);
    const targetModelId = first.candidates![0].model_id;
    const id = (await q<Array<{ id: string }>>(`ai_model_registry?model_id=eq.${encodeURIComponent(targetModelId)}&select=id`))[0].id;

    const scoreFor = async (): Promise<number | null> => {
      const res = await resolve();
      const cand = (res.candidates ?? []).find((c) => c.model_id === targetModelId);
      return cand ? Number(cand.score) : null;
    };

    await callRpc('record_model_benchmark', { p_model_registry_id: id, p_task_type: 'chat', p_overall: 0.0 });
    const low = await scoreFor();

    await callRpc('record_model_benchmark', { p_model_registry_id: id, p_task_type: 'chat', p_overall: 1.0 });
    const high = await scoreFor();

    expect(low, 'the model must remain a resolver candidate').not.toBeNull();
    expect(high).not.toBeNull();
    // Higher benchmark → higher score ⟹ the b.task_type = v_task_kind JOIN matched. No drift.
    expect(high as number).toBeGreaterThan(low as number);
  });
});
