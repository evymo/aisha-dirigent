/**
 * Typovaná chyba zapisovacích a pracovních nástrojů MCP (my_next_steps, complete_step,
 * report_progress) — stejný vzor jako `embedding_unavailable` u hledání (revize bezpečnosti
 * P2, 2026-10-07): volající dostane KÓD z výčtu a id incidentu, nikdy volný text chyby.
 *
 * ⛔ Proč: obecná cesta tools/call vracela `error.message` — u PostgREST to je text z databáze
 *    (jména funkcí, hodnoty argumentů, interní stav). Text jde jen do logu služby pod týmž
 *    incidentem.
 *
 * Kód se odvozuje ze SQLSTATE, který RPC vrátí v těle PostgREST (`code`) — ne z textu zprávy.
 *
 * @module
 */
import { PostgRESTError } from '@aisha/postgrest-client';

export const KODY_CHYBY_PRACE = ['forbidden', 'not_found', 'invalid_input', 'unauthenticated', 'failed'] as const;
export type KodChybyPrace = (typeof KODY_CHYBY_PRACE)[number];

/** SQLSTATE → kód pro volajícího. Neznámý stav = `failed` (podrobnost jen v logu). */
const ZE_SQLSTATE: Record<string, KodChybyPrace> = {
  '42501': 'forbidden',
  P0002: 'not_found',
  '22P02': 'invalid_input',
  '22023': 'invalid_input',
  '23514': 'invalid_input',
  '28000': 'unauthenticated',
};

export class ChybaNastrojePrace extends Error {
  readonly kod: KodChybyPrace;
  constructor(kod: KodChybyPrace, detail: string) {
    super(detail);
    this.name = 'ChybaNastrojePrace';
    this.kod = kod;
  }

  /** Co smí vidět volající: kód z výčtu a incident. */
  toPayload(incident: string): Record<string, unknown> {
    return { error: this.kod, incident };
  }
}

/** SQLSTATE z chyby PostgREST (tělo `{ code }`), jinak null. */
function sqlstate(err: unknown): string | null {
  if (!(err instanceof PostgRESTError)) return null;
  const telo = err.body as { code?: unknown } | null;
  return typeof telo?.code === 'string' ? telo.code : null;
}

/** Libovolná chyba volání RPC pracovního nástroje → typovaná chyba (text zůstává jen v `message`). */
export function chybaPraceZRpc(err: unknown): ChybaNastrojePrace {
  const stav = sqlstate(err);
  const kod = (stav && ZE_SQLSTATE[stav]) || 'failed';
  return new ChybaNastrojePrace(kod, err instanceof Error ? err.message : String(err));
}
