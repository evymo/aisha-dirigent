/**
 * Pruh DOPORUČENÍ identit — spojka mezi světem ingestu a světem účtů.
 *
 * ⛔ DOPORUČENÍ, NE VAZBA (týž axiom jako u advisory artefaktů ingestu,
 * li_entity_suggestions: „doložený vztah, NIKDY automatická vazba"). Pruh jen
 * navrhuje; POTVRZUJE VÝHRADNĚ ČLOVĚK v kokpitu (ratifikační fronta →
 * submit_evidence_review_audited → twin_identity_confirm_binding).
 *
 * Proč vznikl: kontakt převzatý z CRM a člen, který se přihlásil do aplikace,
 * jsou dvě dvojčata, dokud je někdo nespáruje. Nikdo je neporovnával, takže
 * historie z CRM a živá data spolu nikdy nesedly.
 *
 * PII: porovnávané hodnoty (e-maily) putují jen sem a do adaptéru, v paměti,
 * po dobu jednoho taktu. Do jádra se zapisuje POUZE identita nalezená ve zdroji.
 */
import type {
  IDataSource,
  SourceConnection,
  SourceIdentityMatchDeclaration,
} from '@aisha/audience-types';
import { errMessage } from '../errors.js';

export interface MatchPg {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface MatchLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface IdentityMatchKindResult {
  kind: string;
  /** Kolik referencí čekalo na porovnání. */
  candidates: number;
  /** Kolik z nich zdroj poznal. */
  matched: number;
  /** Kolik nálezů skončilo NOVÝM návrhem pro člověka. */
  proposed: number;
  /** Kolik nálezů se přeskočilo, protože člověk tentýž pár už zamítl. */
  skippedRejected: number;
  error?: string;
}

export interface IdentityMatchResult {
  kinds: IdentityMatchKindResult[];
  proposed: number;
  errors: number;
}

/** Kolik hodnot se pošle adaptéru na jeden dotaz. */
const DAVKA = 500;

const SLUG = /^[a-z][a-z0-9_.-]{1,63}$/;

/** Deklarace, které má smysl pouštět: platné slugy, bez duplicit. */
export function declaredMatches(adapter: IDataSource): SourceIdentityMatchDeclaration[] {
  const videno = new Set<string>();
  const out: SourceIdentityMatchDeclaration[] = [];
  for (const d of adapter.config.identityMatches ?? []) {
    if (!SLUG.test(d.kind ?? '') || !SLUG.test(d.fromSource ?? '') || !SLUG.test(d.toSource ?? '')) continue;
    if (!d.refKind || !d.refKind.trim()) continue;
    const klic = `${d.kind}|${d.fromSource}|${d.refKind}|${d.toSource}`;
    if (videno.has(klic)) continue;
    videno.add(klic);
    out.push(d);
  }
  return out;
}

export async function navrhniShodyIdentit(
  adapter: IDataSource,
  conn: SourceConnection,
  aishaPg: MatchPg,
  sourceSlug: string,
  log: MatchLog,
): Promise<IdentityMatchResult> {
  const vysledek: IdentityMatchResult = { kinds: [], proposed: 0, errors: 0 };
  if (typeof adapter.matchIdentities !== 'function') return vysledek;

  const deklarace = declaredMatches(adapter);
  const vadne = (adapter.config.identityMatches ?? []).length - deklarace.length;
  if (vadne > 0) {
    vysledek.errors += vadne;
    log.error({ source: sourceSlug, invalid: vadne }, 'identity-match-lane: ignoring invalid or duplicate declarations');
  }

  for (const d of deklarace) {
    const vr: IdentityMatchKindResult = {
      kind: d.kind, candidates: 0, matched: 0, proposed: 0, skippedRejected: 0,
    };
    try {
      const res = await aishaPg.query<{ items: Array<{ ref_id: string; twin_id: string; value: string }> }>(
        `SELECT public.twin_identity_match_candidates($1::text, $2::text, $3::text, $4::int) AS items`,
        [d.fromSource, d.refKind, d.toSource, DAVKA],
      );
      const kandidati = res.rows[0]?.items ?? [];
      vr.candidates = kandidati.length;
      if (kandidati.length === 0) { vysledek.kinds.push(vr); continue; }

      // Jedno dvojče může nést tutéž hodnotu vícekrát; ptáme se na množinu.
      const podleHodnoty = new Map<string, string[]>();
      for (const k of kandidati) {
        const h = (k.value ?? '').trim();
        if (!h) continue;
        podleHodnoty.set(h, [...(podleHodnoty.get(h) ?? []), k.twin_id]);
      }
      const nalezy = await adapter.matchIdentities(d.kind, [...podleHodnoty.keys()], conn);
      vr.matched = nalezy.length;

      for (const n of nalezy) {
        const dvojcata = podleHodnoty.get((n.value ?? '').trim());
        if (!dvojcata || !n.externalId) continue;
        for (const twinId of new Set(dvojcata)) {
          const p = await aishaPg.query<{ r: { state?: string } }>(
            `SELECT public.twin_identity_propose_match($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric) AS r`,
            [twinId, d.toSource, n.externalId, d.toRefKind ?? 'primary_id',
             `rule:${d.kind}`, d.confidence ?? null],
          );
          const stav = p.rows[0]?.r?.state;
          if (stav === 'skipped_rejected') vr.skippedRejected += 1;
          else if (stav === 'proposed') vr.proposed += 1;
        }
      }
      vysledek.proposed += vr.proposed;
    } catch (err) {
      vr.error = errMessage(err);
      vysledek.errors += 1;
      log.error({ source: sourceSlug, kind: d.kind, err: vr.error }, 'identity-match-lane: match failed');
    }
    vysledek.kinds.push(vr);
  }

  log.info(
    { source: sourceSlug, matches: vysledek.kinds.map((k) => ({
      kind: k.kind, candidates: k.candidates, matched: k.matched,
      proposed: k.proposed, skippedRejected: k.skippedRejected, failed: Boolean(k.error) })) },
    'identity-match-lane: done (návrhy čekají na člověka)',
  );
  return vysledek;
}
