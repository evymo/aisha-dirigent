/**
 * trezor-relaci.ts — klient trezoru relací uživatelů u federovaného zdroje (ADR-004).
 *
 * Mluví s DB výhradně přes RPC `federated_source_session_*` (žádné `.from()`), a to
 * v sezení SERVISNÍ role (volající předá spojení, které je `SET ROLE service_role`
 * s claimem role — viz `jakoSluzba`). Šifruje a dešifruje sám (trezor-sifra.ts).
 *
 * PAMĚŤ (ADR-004 bod 5, revize S2/B16): dešifrovaný token smí zůstat v procesu, klíč
 * = (uživatel, zdroj) a platí jen pro (id relace, verze). Při KAŽDÉM použití se broker
 * zeptá levné `…_version` (bez šifrového textu, bez auditu): odvolání i nahrazení
 * relace tak platí hned, i napříč replikami. Zápisy čtou trezor VŽDY čerstvě
 * (`nactiProZapis`), aby důkaz identity a zápis šly tímtéž tokenem z jednoho čtení.
 */
import { randomUUID } from 'node:crypto';
import { aadRelace, desifruj, zasifruj, type KlicTrezoru } from './trezor-sifra.js';

export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface RelaceZdroje {
  readonly sessionId: string;
  readonly version: number;
  readonly providerId: string;
  readonly token: string;
  readonly refresh: string | null;
  readonly expiresAt: Date;
}

export interface UlozeniRelace {
  readonly sessionId: string;
  /** Předchozí aktivní relace téhož uživatele u zdroje — odvolaná, čeká na odhlášení u zdroje. */
  readonly nahrazenaSessionId: string | null;
}

/** Sezení servisní role: claim napřed, pak role (vzor scheduler.ts / li-driver.ts). */
export async function jakoSluzba(pg: PgLike): Promise<void> {
  await pg.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
  await pg.query('SET ROLE service_role');
}

export function vytvorTrezor(deps: { pg: PgLike; klic: KlicTrezoru }) {
  const { pg, klic } = deps;
  const pamet = new Map<string, RelaceZdroje>();
  const kp = (userId: string, provider: string) => `${userId}|${provider}`;

  async function prectiADesifruj(userId: string, provider: string): Promise<RelaceZdroje | null> {
    const { rows } = await pg.query(
      `SELECT source_session_id, version, provider_id, token_ct, refresh_ct, key_id, expires_at
         FROM public.federated_source_session_get_for_caller($1::uuid, $2::text)`,
      [userId, provider],
    );
    const r = rows[0];
    if (!r) return null;
    const sessionId = String(r.source_session_id);
    const aad = aadRelace(provider, userId, sessionId);
    const token = desifruj(klic, String(r.key_id), r.token_ct as Buffer, aad);
    const refresh = r.refresh_ct ? desifruj(klic, String(r.key_id), r.refresh_ct as Buffer, aad) : null;
    return {
      sessionId,
      version: Number(r.version),
      providerId: String(r.provider_id),
      token,
      refresh,
      expiresAt: new Date(String(r.expires_at)),
    };
  }

  return {
    async uloz(v: {
      userId: string;
      provider: string;
      providerId: string;
      token: string;
      refresh?: string | null;
      expiresAt: Date;
    }): Promise<UlozeniRelace> {
      const sessionId = randomUUID();
      const aad = aadRelace(v.provider, v.userId, sessionId);
      const { rows } = await pg.query(
        `SELECT source_session_id, replaced_source_session_id
           FROM public.federated_source_session_put($1::uuid, $2::uuid, $3::text, $4::text, $5::bytea, $6::bytea, $7::text, $8::timestamptz)`,
        [
          sessionId,
          v.userId,
          v.provider,
          v.providerId,
          zasifruj(klic, v.token, aad),
          v.refresh ? zasifruj(klic, v.refresh, aad) : null,
          klic.keyId,
          v.expiresAt.toISOString(),
        ],
      );
      pamet.delete(kp(v.userId, v.provider));
      const nahrazena = rows[0]?.replaced_source_session_id;
      return { sessionId, nahrazenaSessionId: nahrazena ? String(nahrazena) : null };
    },

    /** Pro ČTENÍ: z paměti, pokud relace pořád platí v téže verzi; jinak z trezoru. */
    async nacti(userId: string, provider: string): Promise<RelaceZdroje | null> {
      const { rows } = await pg.query(
        `SELECT source_session_id, version FROM public.federated_source_session_version($1::uuid, $2::text)`,
        [userId, provider],
      );
      const v = rows[0];
      const klicPameti = kp(userId, provider);
      if (!v) {
        pamet.delete(klicPameti);
        return null;
      }
      const hit = pamet.get(klicPameti);
      if (hit && hit.sessionId === String(v.source_session_id) && hit.version === Number(v.version)) return hit;
      const cerstva = await prectiADesifruj(userId, provider);
      if (cerstva) pamet.set(klicPameti, cerstva);
      else pamet.delete(klicPameti);
      return cerstva;
    },

    /** Pro ZÁPIS: vždy čerstvě z trezoru (1 řádek auditu), nikdy z paměti. */
    async nactiProZapis(userId: string, provider: string): Promise<RelaceZdroje | null> {
      const r = await prectiADesifruj(userId, provider);
      if (!r) pamet.delete(kp(userId, provider));
      return r;
    },

    async odvolej(userId: string, provider: string, duvod: string): Promise<number> {
      pamet.delete(kp(userId, provider));
      const { rows } = await pg.query(`SELECT public.federated_source_session_revoke($1::uuid, $2::text, $3::text) AS n`, [
        userId,
        provider,
        duvod,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /** Refresh / rotace: compare-and-swap na verzi. Prohraný souběh = výjimka STALE, NE odvolání. */
    async obnov(v: {
      userId: string;
      provider: string;
      sessionId: string;
      ocekavanaVerze: number;
      token: string;
      refresh?: string | null;
      expiresAt: Date;
    }): Promise<number> {
      const aad = aadRelace(v.provider, v.userId, v.sessionId);
      const { rows } = await pg.query(
        `SELECT public.federated_source_session_rotate($1::uuid, $2::integer, $3::bytea, $4::bytea, $5::text, $6::timestamptz) AS version`,
        [
          v.sessionId,
          v.ocekavanaVerze,
          zasifruj(klic, v.token, aad),
          v.refresh ? zasifruj(klic, v.refresh, aad) : null,
          klic.keyId,
          v.expiresAt.toISOString(),
        ],
      );
      pamet.delete(kp(v.userId, v.provider));
      return Number(rows[0]?.version);
    },

    /** Jen pro testy a měření: kolik relací drží paměť procesu. */
    velikostPameti(): number {
      return pamet.size;
    },
  };
}

export type TrezorRelaci = ReturnType<typeof vytvorTrezor>;
