/**
 * Model self-test — REAL-environment integration. selfTestModels drives the real
 * get_models_due_self_test + record_model_self_test RPCs over throwaway pg17 +
 * PostgREST: a discovered pending model that RESPONDS advances to eval_status='tested'
 * (with a benchmark row); one that FAILS advances to 'rejected' (then excluded by the
 * PR-D resolver moderation). Closes discover→self-test→moderate.
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

import { selfTestModels, type SelfTestChat } from '../../lib/modelSelfTest.js';

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(p: string): Promise<T> {
  const res = await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
const callRpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`POST rpc/${fn} → ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

RUN('model self-test — discover→self-test→moderate over real DB', () => {
  it('a responding pending model → tested (+ benchmark); a failing one → rejected', async () => {
    // Two freshly-discovered pending models (PR-C upsert).
    await callRpc('upsert_discovered_model', { p_model_id: 'self-test-pass-x', p_provider: 'openai' });
    await callRpc('upsert_discovered_model', { p_model_id: 'self-test-fail-x', p_provider: 'openai' });

    // The probe responds for the good model, throws for the bad one.
    const chat: SelfTestChat = async (o) => {
      if (o.model === 'self-test-fail-x') throw new Error('unreachable');
      return { text: 'OK' };
    };

    const res = await selfTestModels(callRpc, chat, { serviceableProviders: new Set(['openai']) });
    expect(res.tested).toBeGreaterThanOrEqual(2);

    const pass = await q<Array<{ eval_status: string }>>('ai_model_registry?model_id=eq.self-test-pass-x&select=eval_status');
    expect(pass[0].eval_status, 'responding model must advance pending→tested').toBe('tested');

    const fail = await q<Array<{ eval_status: string }>>('ai_model_registry?model_id=eq.self-test-fail-x&select=eval_status');
    expect(fail[0].eval_status, 'failing model must advance pending→rejected').toBe('rejected');

    // The tested model has a benchmark row (feeds the resolver's score ranking).
    const passId = (await q<Array<{ id: string }>>('ai_model_registry?model_id=eq.self-test-pass-x&select=id'))[0].id;
    const bench = await q<Array<unknown>>(`ai_model_benchmarks?model_registry_id=eq.${passId}&select=id`);
    expect(bench.length).toBeGreaterThan(0);
  });

  it('re-running does not re-test a settled model — it is no longer due (get_models_due_self_test = pending only)', async () => {
    const due = await callRpc('get_models_due_self_test', { p_limit: 50 }) as Array<{ model_id: string }>;
    const ids = new Set(due.map((d) => d.model_id));
    expect(ids.has('self-test-pass-x'), 'tested model must not be due again').toBe(false);
    expect(ids.has('self-test-fail-x'), 'rejected model must not be due again').toBe(false);
  });
});
