/**
 * udrzba-federace.ts — jeden tik údržby trezoru relací federovaného zdroje (ADR-004, bod 4 a 6).
 *
 * Nová fronta ani nový úklid NEVZNIKAJÍ: běží to v plánovači brokeru (scheduler.ts) nad
 * stávajícími mechanismy —
 *   - prošlá nonce přihlašovacího toku → `federated_flow_nonces_cleanup()`,
 *   - prošlá okna limitů → stávající `cleanup_old_rate_limits()` (tabulka api_rate_limits),
 *   - odhlášení u zdroje → fronta = řádky trezoru s `revoked_at` a bez `logout_done_at`
 *     (`federated_source_session_logout_due` / `…_logout_result`).
 *
 * ZÁMEK: víc replik brokeru tiká nezávisle. Údržbu dělá vždy jen ta, která získá
 * pojmenovaný advisory lock (ZAMEK_UDRZBY); ostatní tik přeskočí. Bez něj by dvě repliky
 * odhlásily týž token dvakrát a úklid by běžel paralelně (Aisha Guru, podmínka d).
 *
 * Tokeny se dešifrují jen na dobu volání odhlášení a nikam se nelogují.
 */
import { aadRelace, desifruj, type KlicTrezoru } from './trezor-sifra.js';
import type { PgLike } from './trezor-relaci.js';

/** Pojmenovaný klíč advisory locku údržby — dvě jména, `hashtext` počítá DB. */
export const ZAMEK_UDRZBY = { jmeno: 'svc-source-broker', ucel: 'udrzba-federace' } as const;

export type VysledekOdhlaseni = 'hotovo' | 'nepodporovano' | 'selhalo';
export type Odhlasovac = (token: string) => Promise<VysledekOdhlaseni>;

export interface VysledekUdrzby {
  readonly zamek: boolean;
  readonly nonceSmazano: number;
  readonly limityUklizeno: number;
  readonly odhlaseno: number;
  readonly odhlaseniSelhalo: number;
}

interface LoggerLike {
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
}

export async function udrzbaFederace(deps: {
  pg: PgLike;
  klic: KlicTrezoru | null;
  odhlasovace: ReadonlyMap<string, Odhlasovac>;
  logger: LoggerLike;
  davka?: number;
}): Promise<VysledekUdrzby> {
  const { pg, klic, odhlasovace, logger } = deps;
  const { rows: z } = await pg.query(
    `SELECT pg_try_advisory_lock(hashtext($1::text), hashtext($2::text)) AS ok`,
    [ZAMEK_UDRZBY.jmeno, ZAMEK_UDRZBY.ucel],
  );
  if (!z[0]?.ok) {
    return { zamek: false, nonceSmazano: 0, limityUklizeno: 0, odhlaseno: 0, odhlaseniSelhalo: 0 };
  }
  let nonceSmazano = 0;
  let limityUklizeno = 0;
  let odhlaseno = 0;
  let odhlaseniSelhalo = 0;
  try {
    const n = await pg.query(`SELECT public.federated_flow_nonces_cleanup() AS n`);
    nonceSmazano = Number(n.rows[0]?.n ?? 0);
    const l = await pg.query(`SELECT public.cleanup_old_rate_limits() AS n`);
    limityUklizeno = Number(l.rows[0]?.n ?? 0);

    const zdroje = [...odhlasovace.keys()];
    if (zdroje.length > 0 && klic) {
      const { rows } = await pg.query(
        `SELECT source_session_id, user_id, provider, token_ct, key_id
           FROM public.federated_source_session_logout_due($1::text[], $2::integer)`,
        [zdroje, deps.davka ?? 20],
      );
      for (const r of rows) {
        const sessionId = String(r.source_session_id);
        const provider = String(r.provider);
        let vysledek: VysledekOdhlaseni = 'selhalo';
        try {
          const token = desifruj(klic, String(r.key_id), r.token_ct as Buffer, aadRelace(provider, String(r.user_id), sessionId));
          vysledek = await (odhlasovace.get(provider) as Odhlasovac)(token);
        } catch (e) {
          // Chyba nástroje (síť, 5xx, klíč) — relace zůstane ve frontě, další pokus odstupňovaně.
          logger.warn({ provider, sessionId, chyba: e instanceof Error ? e.name : 'neznama' }, 'federace: odhlášení u zdroje neproběhlo');
          vysledek = 'selhalo';
        }
        await pg.query(`SELECT public.federated_source_session_logout_result($1::uuid, $2::text)`, [sessionId, vysledek]);
        if (vysledek === 'selhalo') odhlaseniSelhalo += 1;
        else odhlaseno += 1;
      }
    }
  } finally {
    await pg.query(`SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))`, [ZAMEK_UDRZBY.jmeno, ZAMEK_UDRZBY.ucel]);
  }
  if (nonceSmazano || limityUklizeno || odhlaseno || odhlaseniSelhalo) {
    logger.info({ nonceSmazano, limityUklizeno, odhlaseno, odhlaseniSelhalo }, 'federace: údržba trezoru');
  }
  return { zamek: true, nonceSmazano, limityUklizeno, odhlaseno, odhlaseniSelhalo };
}
