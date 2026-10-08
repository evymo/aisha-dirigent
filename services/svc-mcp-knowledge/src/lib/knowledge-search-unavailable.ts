/**
 * Vektorové hledání ve znalostech SELŽE NAHLAS (P2, 2026-10-06).
 *
 * ⛔ NAMĚŘENO 2026-10-06 (riq, jen čtení): když embedding nešel (lane 503, model nevyřešen),
 * `searchKnowledgeProd` tiše přešel na textové hledání v2. Volající (chat, /v1, n8n) dostal
 * výsledky jiného druhu bez jediné stopy — výpadek modelu vypadal jako běžné hledání. Pravidlo
 * majitele: modelové funkce selhávají nahlas, žádná tichá náhrada.
 *
 * Teď každé selhání vektorového hledání skončí typovanou chybou `embedding_unavailable` s důvodem.
 * Volající ji ukáže jako „vyhledávání nedostupné“ — nikdy jako „nic nenalezeno“.
 *
 * ⛔ REVIZE BEZPEČNOSTI 2026-10-07: volajícímu (kterýkoli přihlášený klient MCP) jde JEN stabilní
 * kód, důvod z výčtu, kód lane z výčtu protokolu a id incidentu — NIKDY volný text chyby. Ten nese
 * hostitele lane/meshe, URL, identitu vah, vnitřek kvót; patří jen do logu služby (bezpečný logger)
 * pod týmž id incidentu.
 *
 * Důvody:
 *   - `embedding_backend`        pro prostor korpusu není živý embedding model (resolver prázdný)
 *   - `embedding_selhal`         kódování dotazu selhalo (lane nedostupná, kvóta, odmítnutí, síť)
 *   - `identita_nedeklarovana`   data instance nedeklarují identitu vah modelu (v3, 22023)
 *   - `identita_nesouhlasi`      dotaz spočítaly jiné váhy, než deklarace (v3, 22023)
 *
 * @module
 */
import { jeDuvod, type Duvod } from '@aisha/accel-protokol';
import { rpcService } from '../postgrest.js';
/**
 * Pro prostor korpusu není živý embedding model (resolver nevrátil řádek). Vlastní třída, aby
 * volající odlišil „nemáme čím kódovat“ od selhání samotného kódování (lane, kvóta) — obojí
 * hledání ZASTAVÍ, ale důvod jde k uživateli i do logu. Žije tady (ne v embed-query-in-space),
 * aby ji klasifikace níž znala bez cyklu importů.
 */
export class EmbeddingSpaceUnresolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingSpaceUnresolvedError';
  }
}

export const KNOWLEDGE_SEARCH_UNAVAILABLE = 'embedding_unavailable' as const;

/** Vektor dotazu + identita vah, kterou k němu ohlásila lane (tvar EmbeddedQuery, bez importu). */
interface DotazSIdentitou {
  backend: { model_id: string };
  identita: { identita: string } | null;
}

/** Deklarovaná identita vah modelu — služební rovina (fn_deklarace_vah_embeddingu má EXECUTE jen služba). */
export async function deklaraceVahSluzbou(modelId: string): Promise<string | null> {
  const radky = await rpcService<Array<{ identita: string }>>('fn_deklarace_vah_embeddingu', { p_model_id: modelId });
  return Array.isArray(radky) ? (radky[0]?.identita ?? null) : null;
}

/**
 * Ověř identitu vah, kterou lane ohlásila k vektoru DOTAZU, proti deklaraci modelu — na SLUŽEBNÍ
 * rovině, PŘED hledáním. Revize bezpečnosti 2026-10-07: dřív šla identita jako parametr v3, kterou
 * volá i přihlášený klient — kdo zkoušel hodnoty, poznal deklaraci (orákulum). Teď v3 identitu od
 * volajícího nebere vůbec (filtruje podle deklarace) a tahle kontrola běží u služby.
 * Backend bez identity (null): nic k ověření — filtr v3 stejně pustí jen vektory deklarace.
 */
export async function overIdentituDotazu(
  dotaz: DotazSIdentitou,
  deklarace: (modelId: string) => Promise<string | null> = deklaraceVahSluzbou,
): Promise<void> {
  if (!dotaz.identita) return;
  let deklarovana: string | null;
  try {
    deklarovana = await deklarace(dotaz.backend.model_id);
  } catch (err) {
    throw nedostupnostZIdentity(err) ?? new KnowledgeSearchUnavailableError('identita_nedeklarovana', zprava(err));
  }
  if (!deklarovana) {
    throw new KnowledgeSearchUnavailableError('identita_nedeklarovana', `model ${dotaz.backend.model_id} nemá deklaraci vah`);
  }
  if (dotaz.identita.identita !== deklarovana) {
    throw new KnowledgeSearchUnavailableError(
      'identita_nesouhlasi',
      `lane ohlásila k dotazu identitu ${dotaz.identita.identita}, data deklarují ${deklarovana} (model ${dotaz.backend.model_id})`,
    );
  }
}

export type DuvodNedostupnosti =
  | 'embedding_backend'
  | 'embedding_selhal'
  | 'identita_nedeklarovana'
  | 'identita_nesouhlasi';

/** Tvar chyby, který jde volajícímu nástroje (MCP `isError` výsledek). */
export interface KnowledgeSearchUnavailablePayload {
  error: typeof KNOWLEDGE_SEARCH_UNAVAILABLE;
  reason: DuvodNedostupnosti;
  /** Kód lane z výčtu protokolu (LANE_NEDOSTUPNA, KVOTA_PREKROCENA …), je-li znám. */
  lane?: Duvod;
  /** Id incidentu — podle něj správce najde podrobnosti v logu služby. */
  incident: string;
}

/** Kód lane jen z uzavřeného výčtu protokolu (@aisha/accel-protokol) — nikdy volný text. */
const kodLane = (x: unknown): Duvod | undefined => (jeDuvod(x) ? x : undefined);

export class KnowledgeSearchUnavailableError extends Error {
  readonly code = KNOWLEDGE_SEARCH_UNAVAILABLE;
  readonly lane?: Duvod;
  constructor(
    readonly reason: DuvodNedostupnosti,
    /** Podrobnost JEN pro log služby — do odpovědi se nikdy nedostane. */
    message: string,
    lane?: unknown,
  ) {
    super(message);
    this.name = 'KnowledgeSearchUnavailableError';
    this.lane = kodLane(lane);
  }

  /** Odpověď volajícímu: kód, důvod, kód lane, incident. Bez volného textu (viz hlavička). */
  toPayload(incident: string): KnowledgeSearchUnavailablePayload {
    return {
      error: KNOWLEDGE_SEARCH_UNAVAILABLE,
      reason: this.reason,
      ...(this.lane ? { lane: this.lane } : {}),
      incident,
    };
  }
}

const zprava = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Selhání při kódování dotazu (resolver nebo embed) → typovaná nedostupnost. Nic jiného nevrací. */
export function nedostupnostZEmbeddingu(err: unknown): KnowledgeSearchUnavailableError {
  if (err instanceof EmbeddingSpaceUnresolvedError) {
    return new KnowledgeSearchUnavailableError('embedding_backend', err.message);
  }
  // EmbedDispatchError (embed-dispatcher) podle jména, ne instanceof: modul se v testech služby
  // mockuje a klasifikace nesmí na chybějící třídě sama spadnout. Nese kód lane (`duvod`).
  if (err instanceof Error && err.name === 'EmbedDispatchError') {
    return new KnowledgeSearchUnavailableError('embedding_selhal', err.message, (err as { duvod?: unknown }).duvod);
  }
  return new KnowledgeSearchUnavailableError('embedding_selhal', zprava(err));
}

/**
 * Chyba RPC → nedostupnost, JE-LI to nedeklarovaná identita vah (strojová značka ze SQL
 * `embedding_identity_undeclared`). Jiné chyby (přístup k příběhu 42501, výpadek DB) vrací null —
 * volající je propustí beze změny.
 */
export function nedostupnostZIdentity(err: unknown): KnowledgeSearchUnavailableError | null {
  const text = `${zprava(err)} ${typeof (err as { body?: unknown })?.body === 'string' ? (err as { body: string }).body : ''}`;
  if (text.includes('embedding_identity_undeclared')) {
    return new KnowledgeSearchUnavailableError('identita_nedeklarovana', zprava(err));
  }
  return null;
}
