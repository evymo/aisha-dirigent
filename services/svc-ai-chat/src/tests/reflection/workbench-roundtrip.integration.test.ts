/**
 * Workbench rail — REAL-environment integration. Proves the PR-J work queue end to end
 * over throwaway pg17 + PostgREST: enqueue (svc) → atomic claim (extension, FOR UPDATE SKIP
 * LOCKED) → complete (extension) → fetch (svc block-poll), plus the idempotent re-complete
 * and a failed completion. The extension is simulated by calling its RPCs directly.
 *
 * Run: npm run test:reflection:fullenv (skips offline).
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

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

RUN('workbench rail — enqueue→claim→complete→fetch round-trip', () => {
  it('full round-trip + atomic claim (SKIP LOCKED) + idempotent complete', async () => {
    const reqId = await callRpc<string>('enqueue_workbench_request', { p_clow: { purpose: 'rt' }, p_input: 'hello' });
    expect(reqId).toBeTruthy();

    // CLAIM → exactly the enqueued row, now 'claimed'.
    const claimed = await callRpc<Array<{ id: string; status: string; request_input: string }>>(
      'claim_pending_workbench_requests', { p_limit: 1, p_session_id: 'test-sess' });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(reqId);
    expect(claimed[0].status).toBe('claimed');
    expect(claimed[0].request_input).toBe('hello');

    // A second claim immediately returns nothing — the row is no longer pending.
    const claimed2 = await callRpc<Array<unknown>>('claim_pending_workbench_requests', { p_limit: 1, p_session_id: 'test-sess' });
    expect(claimed2).toHaveLength(0);

    // COMPLETE (ok) → updated.
    const done = await callRpc<{ updated: boolean; status: string }>(
      'complete_workbench_request', { p_ok: true, p_output: 'world', p_request_id: reqId });
    expect(done).toMatchObject({ updated: true, status: 'completed' });

    // FETCH (the central block-poll) → completed + output.
    const fetched = await callRpc<{ status: string; output: string }>('fetch_workbench_result', { p_request_id: reqId });
    expect(fetched).toMatchObject({ status: 'completed', output: 'world' });

    // A re-complete is an idempotent no-op (status guard) — output stays.
    const done2 = await callRpc<{ updated: boolean }>(
      'complete_workbench_request', { p_ok: true, p_output: 'again', p_request_id: reqId });
    expect(done2.updated).toBe(false);
    const fetched2 = await callRpc<{ output: string }>('fetch_workbench_result', { p_request_id: reqId });
    expect(fetched2.output).toBe('world');
  });

  it('a failed completion records the error detail', async () => {
    const reqId = await callRpc<string>('enqueue_workbench_request', { p_clow: {}, p_input: 'x' });
    await callRpc('complete_workbench_request', { p_error: 'edge_down', p_ok: false, p_request_id: reqId });
    const fetched = await callRpc<{ status: string; error_detail: { message: string } }>(
      'fetch_workbench_result', { p_request_id: reqId });
    expect(fetched.status).toBe('failed');
    expect(fetched.error_detail?.message).toBe('edge_down');
  });
});
