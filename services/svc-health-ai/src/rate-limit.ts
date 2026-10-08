/**
 * Stráž limitu analýz nad `enforce_rate_limit` (aisha/db/sql/functions/enforce_rate_limit.sql).
 *
 * ⛔ NAMĚŘENO (čtení upstream mainu 66b4e84ff): routy měly `try { enforce_rate_limit }
 * catch { 429 }` — z KAŽDÉ chyby „rate limited". Výpadek PostgRESTu, cizí výjimka
 * i (do opravy @aisha/postgrest-client 0.1.3) úspěšná odpověď 204 na funkci
 * RETURNS void skončily jako 429 a u dokumentu jako falešný audit „rate_limited".
 *
 * PROČ podle SQLSTATE + zprávy: funkce hlásí překročení `RAISE EXCEPTION 'Rate
 * limit exceeded for %. …'` BEZ `USING ERRCODE` ⇒ SQLSTATE P0001 (raise_exception)
 * ⇒ PostgREST 400 + JSON `{ code: 'P0001', message }`. P0001 ale nese KAŽDÝ RAISE
 * bez ERRCODE, proto samotný kód nestačí — rozhoduje i začátek zprávy s klíčem
 * endpointu, který volající sám poslal. (Servisní varianta enforce_rate_limit_for
 * už hlásí vlastní SQLSTATE P0429; tuhle funkci volají i jiné SQL funkce a mobil,
 * proto se její tvar tady nemění.)
 *
 * Vše ostatní je PORUCHA STRÁŽE, ne překročení — a výpadek stráže limitu je
 * fail-closed: požadavek dál nepustit (503), ale ani ho nezapsat jako „rate limited".
 */
import { PostgRESTError } from '@aisha/postgrest-client';

/** SQLSTATE `RAISE EXCEPTION` bez `USING ERRCODE`. */
const RAISE_EXCEPTION_SQLSTATE = 'P0001';

function parsedErrorBody(body: unknown): { code?: unknown; message?: unknown } | null {
  if (typeof body !== 'string' || body.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as { code?: unknown; message?: unknown }) : null;
  } catch {
    return null;
  }
}

/**
 * Je chyba z `enforce_rate_limit` právě překročení limitu pro `endpointKey`?
 * `false` pro cokoli jiného (síť, 5xx, jiná výjimka, jiný klíč) — volající pak
 * odpoví 503, ne 429.
 */
export function isRateLimitExceeded(err: unknown, endpointKey: string): boolean {
  if (!(err instanceof PostgRESTError)) return false;
  const body = parsedErrorBody(err.body);
  return (
    body?.code === RAISE_EXCEPTION_SQLSTATE &&
    typeof body.message === 'string' &&
    body.message.startsWith(`Rate limit exceeded for ${endpointKey}.`)
  );
}

/**
 * Pole do logu při poruše stráže — BEZ HODNOT: žádné tělo odpovědi, zpráva
 * výjimky ani token; jen co se dá bezpečně porovnat napříč výskyty.
 */
export function rateLimitFailureLogFields(err: unknown, endpointKey: string): Record<string, unknown> {
  return {
    event: 'rate_limit_check_failed',
    rpc: 'enforce_rate_limit',
    endpoint_key: endpointKey,
    error_class: err instanceof Error ? err.name : typeof err,
    postgrest_status: err instanceof PostgRESTError ? err.status : null,
  };
}
