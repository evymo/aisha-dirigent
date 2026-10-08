import { config } from './config.js';

export async function rpcService<T>(functionName: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.postgrestUrl}/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.postgrestServiceToken}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`RPC ${functionName} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  // Funkce RETURNS void (update_agent_run_status) → PostgREST odpoví PRÁZDNÝM tělem.
  // `res.json()` na něm spadl „Unexpected end of JSON input“ AŽ PO zápisu stavu
  // 'running': POST /runs vrátil 500 a běh zůstal 'running' navždy, plugin se
  // nespustil (naměřeno na instanci 2026-09-29 09:55Z, hned po opravě enqueue #444).
  // Testy tras rpcService mockují, proto to nechytily — měří se v db.unit.test.ts.
  const telo = await res.text();
  return (telo === '' ? undefined : JSON.parse(telo)) as T;
}
