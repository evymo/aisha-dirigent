/**
 * Relace TABLETU (F2-B) — krátký token PostgRESTu pro účet zařízení.
 *
 * ⭐ Majitel 2026-09-29: schválený tablet se po klepání dostane do aplikace BEZ přihlášení,
 * jen k předáním naší dopravy. Identitu dokazuje podpis AISHA-REQ1 klíčem z průkazu
 * (routes/zarizeni-klic.ts); tady se jen vydá token pro účet, který průkazu patří.
 *
 * Tvar je týž jako u ostatních tokenů, které gateway vydává sama (intranet.ts): HS256
 * podepsaný JWT_SECRET, `role: authenticated`, vlastní `jti`, bez `aud`. Gateway tokeny,
 * které nejsou z Keycloaku, posílá PostgRESTu beze změny a `auth.uid()` čte `aisha_user_id`.
 *
 * ⛔ Token je „KDO mluví“, ne „CO smí“: co tablet uvidí, rozhoduje pátá cesta predikátu,
 * která ověřuje průkaz při KAŽDÉM volání — odvolání platí hned, i uprostřed platnosti.
 * `device_kid` v tokenu DB uzná jen proti průkazu auth.uid() (current_device_kid).
 */
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

/** Nejvýš jako tokeny z překladu Keycloaku (postgrest-jwt.ts). */
export const RELACE_ZARIZENI_TTL_S = 900;
export const RELACE_ZARIZENI_ISS = 'aisha-gateway/zarizeni';

export interface VstupRelace {
  ucetId: string;
  kid: string;
  /** Konec platnosti průkazu (ISO) — relace ho nikdy nepřesáhne. */
  platiDo: string | null;
  tedS?: number;
}

export async function vydejTokenZarizeni(v: VstupRelace, tajemstvi: string): Promise<{ token: string; exp: number }> {
  if (!tajemstvi) throw new Error('missing_postgrest_jwt_secret');
  const ted = v.tedS ?? Math.floor(Date.now() / 1000);
  const konecPrukazu = v.platiDo ? Math.floor(Date.parse(v.platiDo) / 1000) : Number.POSITIVE_INFINITY;
  const exp = Math.min(ted + RELACE_ZARIZENI_TTL_S, konecPrukazu);
  if (!Number.isFinite(exp) || exp <= ted) throw new Error('prukaz_vyprsel');
  const token = await new SignJWT({
    aisha_user_id: v.ucetId,
    device_kid: v.kid,
    iss: RELACE_ZARIZENI_ISS,
    role: 'authenticated',
    sub: v.ucetId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(ted)
    .setJti(randomUUID())
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(tajemstvi));
  return { exp, token };
}

/**
 * Strop vydaných relací na průkaz (po OVĚŘENÍ podpisu — cizí požadavek s cizím kid tablet
 * nezablokuje). Chrání audit a DB před smyčkou v appce; appka si relaci obnovuje ~1× za 15 min.
 */
export function vytvorStropRelaci(max: number, oknoMs: number, ted: () => number = () => Date.now()) {
  const vydane = new Map<string, number[]>();
  return (kid: string): boolean => {
    const t = ted();
    const cerstve = (vydane.get(kid) ?? []).filter((x) => t - x < oknoMs);
    if (cerstve.length >= max) {
      vydane.set(kid, cerstve);
      return false;
    }
    cerstve.push(t);
    vydane.set(kid, cerstve);
    return true;
  };
}
