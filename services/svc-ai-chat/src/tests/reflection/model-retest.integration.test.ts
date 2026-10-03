/**
 * Model re-test — REAL-environment integration. The admin re-test path lets a settled
 * model be re-probed: record_model_self_test(p_force) re-tests a 'rejected' model, and
 * get_models_due_self_test(p_mode) selects the right eval_status set. THE INVARIANT: an
 * 'approved' admin verdict is NEVER overwritten, even with force.
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
const statusOf = async (id: string): Promise<string> =>
  (await q<Array<{ eval_status: string }>>(`ai_model_registry?id=eq.${id}&select=eval_status`))[0].eval_status;

RUN('model re-test — force semantics + due modes over real DB', () => {
  it('a rejected model: force=false keeps it rejected; force=true re-tests it', async () => {
    await callRpc('upsert_discovered_model', { p_model_id: 'retest-rej-x', p_provider: 'openai' });
    const id = (await q<Array<{ id: string }>>('ai_model_registry?model_id=eq.retest-rej-x&select=id'))[0].id;

    // Fail it → rejected.
    await callRpc('record_model_self_test', { p_model_registry_id: id, p_passed: false });
    expect(await statusOf(id)).toBe('rejected');

    // Re-test passing WITHOUT force → still rejected (verdict preserved).
    const r1 = await callRpc<{ admin_verdict_preserved: boolean }>('record_model_self_test', { p_model_registry_id: id, p_passed: true, p_force: false });
    expect(r1.admin_verdict_preserved).toBe(true);
    expect(await statusOf(id)).toBe('rejected');

    // Re-test passing WITH force → tested.
    const r2 = await callRpc<{ eval_status: string }>('record_model_self_test', { p_model_registry_id: id, p_passed: true, p_force: true });
    expect(r2.eval_status).toBe('tested');
    expect(await statusOf(id)).toBe('tested');
  });

  it('an approved model is NEVER overwritten, even with force (the invariant)', async () => {
    await callRpc('upsert_discovered_model', { p_model_id: 'retest-app-x', p_provider: 'openai' });
    const id = (await q<Array<{ id: string }>>('ai_model_registry?model_id=eq.retest-app-x&select=id'))[0].id;
    // Set 'approved' directly (approve_model_admin is not granted to the service token);
    // the eval_status state is identical, which is what record_model_self_test guards on.
    const patch = await fetch(`${BASE}/ai_model_registry?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ eval_status: 'approved' }),
    });
    expect(patch.ok, await patch.text()).toBe(true);
    expect(await statusOf(id)).toBe('approved');

    const r = await callRpc<{ admin_verdict_preserved: boolean }>('record_model_self_test', { p_model_registry_id: id, p_passed: false, p_force: true });
    expect(r.admin_verdict_preserved).toBe(true);
    expect(await statusOf(id), 'an approved model must survive a forced failing re-test').toBe('approved');
  });

  it('get_models_due_self_test modes select the right eval_status sets (never approved)', async () => {
    const pending = await callRpc<Array<{ eval_status: string }>>('get_models_due_self_test', { p_limit: 500, p_mode: 'pending' });
    expect(pending.every((m) => m.eval_status === 'pending')).toBe(true);

    const rejected = await callRpc<Array<{ eval_status: string }>>('get_models_due_self_test', { p_limit: 500, p_mode: 'rejected-only' });
    expect(rejected.every((m) => m.eval_status === 'rejected')).toBe(true);

    const settled = await callRpc<Array<{ eval_status: string }>>('get_models_due_self_test', { p_limit: 500, p_mode: 'all-settled' });
    expect(settled.every((m) => ['pending', 'tested', 'rejected'].includes(m.eval_status))).toBe(true);
    expect(settled.some((m) => m.eval_status === 'approved')).toBe(false);
  });

  it('rejects an invalid p_mode', async () => {
    await expect(callRpc('get_models_due_self_test', { p_limit: 5, p_mode: 'bogus' })).rejects.toThrow();
  });
});
