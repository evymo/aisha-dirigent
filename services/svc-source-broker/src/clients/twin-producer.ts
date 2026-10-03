/**
 * TWIN PRODUCER — entity profiles from a local-ingest bundle become twin PROPOSALS.
 *
 * The ingest engine derives entities from parameter distribution (stage E4b): which
 * fields bear identity, which merely describe a relation, and how much support each
 * carries. What it cannot know is what those entities ARE to this platform — that is
 * instance vocabulary, and it lives in `twin_parameter_definitions`.
 *
 * So the seam is a JOIN, not a hardcoded table: a catalog row may declare
 * `metadata.ingest_field`, naming the artifact field it corresponds to. This producer
 * matches a profile's identity parameters against that map and lets the entity_type
 * follow from what the parameters say — never from the field's spelling. A profile
 * whose parameters map to nothing is skipped, loudly counted, never guessed into a type.
 *
 * Nothing here confirms anything. Every twin is upserted with its evidence and every
 * identity value is offered through `twin_identity_propose_binding` (state=proposed,
 * with confidence + proposed_by). Confirmation stays human — that is the whole point
 * of the review lane this feeds (wb_twin_unmatched / get_twin_ref_review_block).
 */
import path from 'node:path';

import type { FastifyBaseLogger } from 'fastify';
import type { Client as PgClient } from 'pg';

import type { LiBundle, LiManifest } from './li-driver.js';
import { readJsonl } from './li-driver.js';

/** `proposed_by` recorded on every binding this producer offers. */
export const PROPOSED_BY = 'ingest:entity-profile';

export interface TwinProposalCounts {
  /** Twins upserted (created or matched) from entity profiles. */
  twins: number;
  /** Identity bindings offered for human confirmation. */
  bindings: number;
  /** Profiles skipped because no identity parameter maps to a catalog entry. */
  unmapped: number;
}

/** One catalog row that ties an artifact field to a platform parameter + entity type. */
interface CatalogEntry {
  code: string;
  entityType: string;
  /** Instance v katalogu prohlásila parametr za JMÉNO entity (`metadata.label`). */
  label?: boolean;
}

export function emptyProposalCounts(): TwinProposalCounts {
  return { twins: 0, bindings: 0, unmapped: 0 };
}

/**
 * ingest field name -> catalog entry. Only rows that opt in via
 * `metadata.ingest_field` participate; the catalog stays the instance's to own.
 */
export async function loadIngestFieldMap(pg: PgClient): Promise<Map<string, CatalogEntry>> {
  const res = await pg.query<{ code: string; entity_type: string; ingest_field: string; label: boolean | null }>(
    `SELECT code, entity_type, metadata->>'ingest_field' AS ingest_field,
            metadata->'label' = 'true'::jsonb AS label
       FROM public.twin_parameter_definitions
      WHERE metadata ? 'ingest_field'`
  );
  const map = new Map<string, CatalogEntry>();
  for (const row of res.rows) {
    if (row.ingest_field) {
      map.set(row.ingest_field, { code: row.code, entityType: row.entity_type, label: row.label === true });
    }
  }
  return map;
}

/**
 * Which entity type do these parameters describe? The parameters decide: the type
 * backed by the most of them wins. A tie is NOT broken by preference — an ambiguous
 * profile is left untyped so it surfaces for review instead of being filed by a coin flip.
 */
export function deriveEntityType(
  parameters: string[],
  fieldMap: Map<string, CatalogEntry>
): string | null {
  const votes = new Map<string, number>();
  for (const p of parameters) {
    const hit = fieldMap.get(p);
    if (hit) votes.set(hit.entityType, (votes.get(hit.entityType) ?? 0) + 1);
  }
  if (votes.size === 0) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
  return ranked[0]![0];
}

/**
 * The value a twin is keyed by. Identity parameters are ordered by the exclusivity the
 * engine measured, so the most discriminating one keys the twin; ties fall back to the
 * parameter name so the key is stable across runs (a wobbling key would mint duplicates).
 */
export function pickSourceKey(
  profile: Record<string, unknown>,
  identityParams: string[],
  fieldMap: Map<string, CatalogEntry>
): { param: string; value: string } | null {
  const exclusivity = (profile.exclusivity ?? {}) as Record<string, number>;
  const parameters = (profile.parameters ?? {}) as Record<string, { values?: { value: string }[] }>;
  const ranked = identityParams
    .filter((p) => fieldMap.has(p) && parameters[p]?.values?.length)
    .sort((a, b) => (exclusivity[b] ?? 0) - (exclusivity[a] ?? 0) || a.localeCompare(b));
  const param = ranked[0];
  if (!param) return null;
  const value = parameters[param]!.values![0]!.value;
  return value ? { param, value: String(value) } : null;
}

type ProfileValue = { value: string; period?: unknown; observations?: number };

/**
 * AKTUÁLNÍ hodnota parametru: nejpozdější konec období (engine ≥ 1.4 nese u hodnoty
 * `period: [od, do]`), při shodě víc pozorování, jinak pořadí enginu. Ne nejčastější:
 * firma, která se před rokem přejmenovala, má starého jména víc dokladů než nového.
 */
export function currentValue(values: ProfileValue[]): string | null {
  const konec = (v: ProfileValue) =>
    Array.isArray(v.period) && typeof v.period[1] === 'string' ? v.period[1] : '';
  const serazene = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) =>
      konec(b.v).localeCompare(konec(a.v)) ||
      (b.v.observations ?? 0) - (a.v.observations ?? 0) ||
      a.i - b.i);
  const prvni = serazene[0]?.v;
  return prvni ? String(prvni.value) : null;
}

/**
 * A human-readable label.
 *
 * ⭐ SOUČASNOST PRVNÍ (majitel 2026-09-28: uživatel se ptá na aktuální stav, historie
 * nesmí převážit). Parametr, který instance v katalogu prohlásila za JMÉNO
 * (`twin_parameter_definitions.metadata.label`), dá label svou AKTUÁLNÍ hodnotou — i když
 * je nestabilní. Právě přejmenování ho nestabilním dělá: dřívější pravidlo („první
 * STABILNÍ parametr") pak sáhlo po adrese nebo IČO a twin firmy se jmenoval „Doksanská
 * 22/11" (naměřeno 2026-09-28: 145 twinů s IČO mělo label jiný než poslední jméno
 * z dokladů). Bez deklarace v katalogu platí původní pravidlo beze změny.
 */
function pickLabel(
  profile: Record<string, unknown>,
  identityParams: string[],
  fieldMap?: Map<string, CatalogEntry>
): string | null {
  const parameters = (profile.parameters ?? {}) as Record<
    string,
    { values?: ProfileValue[]; stable?: boolean }
  >;
  const jmeno = identityParams.find((p) => fieldMap?.get(p)?.label && parameters[p]?.values?.length);
  if (jmeno) return currentValue(parameters[jmeno]!.values!);
  const named = identityParams.find((p) => parameters[p]?.stable && parameters[p]?.values?.length);
  const any = identityParams.find((p) => parameters[p]?.values?.length);
  const chosen = named ?? any;
  return chosen ? String(parameters[chosen]!.values![0]!.value) : null;
}

/**
 * Turn `entity_profile_artifact.jsonl` into twin proposals.
 *
 * Runs after the evidence upserts so a failure here cannot cost the bundle its
 * li_* rows; the twin lane is additive and re-running is idempotent (the RPCs
 * dedupe on (source, source_key) and never touch a confirmed binding).
 */
export async function proposeTwinsFromProfiles(
  pg: PgClient,
  bundle: LiBundle,
  logger: FastifyBaseLogger
): Promise<TwinProposalCounts> {
  const { dir, manifest } = bundle;
  const counts = emptyProposalCounts();
  const profiles = readJsonl(path.join(dir, 'entity_profile_artifact.jsonl'));
  if (profiles.length === 0) return counts;

  const fieldMap = await loadIngestFieldMap(pg);
  if (fieldMap.size === 0) {
    // No catalog row opted in — the instance has not described its vocabulary yet.
    // Say so once, plainly: silence here would read as "there were no entities".
    logger.warn(
      { export_id: manifest.export_id, profiles: profiles.length },
      'twin-producer: twin_parameter_definitions has no metadata.ingest_field rows — ' +
        'entity profiles cannot be typed and no twin was proposed'
    );
    counts.unmapped = profiles.length;
    return counts;
  }

  const source = sourceOf(manifest);
  for (const profile of profiles) {
    const identityParams = (profile.identity_parameters ?? []) as string[];
    const entityType = deriveEntityType(identityParams, fieldMap);
    const key = pickSourceKey(profile, identityParams, fieldMap);
    if (!entityType || !key) {
      counts.unmapped += 1;
      continue;
    }

    const upsert = await pg.query<{ result: { twin_id?: string } }>(
      `SELECT public.twin_upsert_entity_audited($1::text, $2::text, $3::text, $4::text, NULL, $5::jsonb)
         AS result`,
      [
        entityType,
        source,
        key.value,
        pickLabel(profile, identityParams, fieldMap),
        JSON.stringify({
          export_id: manifest.export_id,
          engine_version: manifest.engine_version ?? null,
          confidence: profile.confidence ?? null,
          observations: profile.observations ?? null,
          identity_parameters: identityParams,
          relational_parameters: profile.relational_parameters ?? [],
          exclusivity: profile.exclusivity ?? {},
          period: profile.period ?? null,
          parameters: profile.parameters ?? {},
        }),
      ]
    );
    const twinId = upsert.rows[0]?.result?.twin_id;
    if (!twinId) continue;
    counts.twins += 1;

    // Every identity value is offered separately: one may already be confirmed to
    // another twin, and that conflict belongs in review — not silently merged here.
    const parameters = (profile.parameters ?? {}) as Record<
      string,
      { values?: { value: string; support?: number }[] }
    >;
    for (const param of identityParams) {
      const entry = fieldMap.get(param);
      const value = parameters[param]?.values?.[0];
      if (!entry || !value?.value) continue;
      await pg.query(
        `SELECT public.twin_identity_propose_binding(
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric, $7::text) AS result`,
        [
          twinId,
          source,
          String(value.value),
          entry.code,
          PROPOSED_BY,
          value.support ?? profile.confidence ?? null,
          `export ${manifest.export_id}`,
        ]
      );
      counts.bindings += 1;
    }
  }

  if (counts.unmapped > 0) {
    logger.info(
      { export_id: manifest.export_id, ...counts },
      'twin-producer: some entity profiles carried no catalogued identity parameter'
    );
  }
  return counts;
}

/** Where the proposal came from — the bundle's own slug, never a hardcoded name. */
function sourceOf(manifest: LiManifest): string {
  return manifest.source_slug?.trim() || 'local-ingest';
}

export interface PromotionReplayCounts {
  /** Twins upserted from signed identity decisions (op=twin_upsert). */
  twins: number;
  /** Bindings offered to the ratification queue (op=binding). */
  bindings: number;
  /** Bindings whose target twin does not exist yet — deferred, retried next bundle. */
  deferred: number;
  /** Refs the driver added itself so a promotion could land (self-healing bridge). */
  bridged: number;
}

export function emptyPromotionCounts(): PromotionReplayCounts {
  return { twins: 0, bindings: 0, deferred: 0, bridged: 0 };
}

/**
 * Replay `promotions_artifact.jsonl` — the engine's DECIDED identity extract.
 *
 * The seam was wired from one side only: the engine has exported this artifact
 * since the promotion lane existed, and nothing on the platform ever read it —
 * signed merges and measured identifications died in the bundle directory
 * (measured 2026-08-01, same failure class as the entity-profiles file that
 * never travelled).
 *
 * Replay is MECHANICAL on purpose: every row already says what to call and with
 * what evidence (op, keys, confidence, note). The driver interprets nothing —
 * "spojení dělá sám ingest, platforma doručuje, člověk ratifikuje."
 *
 * A binding whose target twin is missing is DEFERRED, not invented: the row
 * stays in the artifact and the next bundle retries it (RPCs are idempotent).
 * Inventing the twin here would decide the very question the row is asking.
 */
/**
 * Provenience návrhu mostu: KDE se shoda vzala (export, doklad) a KDY — ať člověk
 * u návrhu vidí, z čeho stroj usuzoval, a ne jen holé „navrženo".
 */
export function mostProvenience(jmeno: string, row: Record<string, unknown>, manifest: { export_id?: string }): string {
  const doklad = typeof row.source_key === 'string' && row.source_key ? row.source_key.slice(0, 12) : '—';
  return `most navržen shodou jména „${jmeno}" · export ${manifest.export_id ?? '—'} · doklad ${doklad} · ${new Date().toISOString().slice(0, 10)}`;
}

export async function replayPromotions(
  pg: PgClient,
  bundle: LiBundle,
  logger: FastifyBaseLogger
): Promise<PromotionReplayCounts> {
  const { dir, manifest } = bundle;
  const counts = emptyPromotionCounts();
  const rows = readJsonl(path.join(dir, 'promotions_artifact.jsonl'));
  if (rows.length === 0) return counts;

  // Twin world of this seam: promotion rows key their twins under the engine's
  // own source (the artifact contract), independent of the bundle slug.
  const TWIN_SOURCE = 'local-ingest';

  for (const row of rows) {
    if (row.op !== 'twin_upsert') continue;
    try {
      const res = await pg.query<{ result: { twin_id?: string } }>(
        `SELECT public.twin_upsert_entity_audited($1::text, $2::text, $3::text, $4::text, NULL, $5::jsonb)
           AS result`,
        [
          String(row.entity_type ?? ''),
          typeof row.source === 'string' ? row.source : TWIN_SOURCE,
          String(row.source_key ?? ''),
          typeof row.label === 'string' ? row.label : null,
          JSON.stringify({ ...((row.metadata as object) ?? {}), export_id: manifest.export_id }),
        ]
      );
      if (res.rows[0]?.result?.twin_id) counts.twins += 1;
    } catch (err) {
      logger.warn({ err }, 'li-driver: promotion twin upsert failed, bundle continues');
    }
  }

  for (const row of rows) {
    if (row.op !== 'binding') continue;
    try {
      const twin = await pg.query<{ twin_id: string }>(
        `SELECT r.twin_id
           FROM public.twin_external_refs r
          WHERE r.source = $1 AND r.source_key = $2 AND r.ref_kind = 'primary_id'
          LIMIT 1`,
        [TWIN_SOURCE, String(row.twin_source_key ?? '')]
      );
      let twinId = twin.rows[0]?.twin_id;

      // MOST SE DOPLNÍ SÁM. Promoce klíčuje twin otiskem, který zná jen engine;
      // instanční data ten otisk přiřazují existujícím dvojčatům jedním SQL,
      // jenže to běží při deploy — tedy DŘÍV, než z prvního balíku vzniknou
      // dvojčata, na která se váže. Po wipe by tak most pokryl jen to, co je
      // v instančních datech (naměřeno 2026-08-02: 98 z 942), a zbytek by se
      // navždy odkládal jako „twin neexistuje" — vada, která vypadá jako
      // prázdná fronta.
      //
      // Když tedy otisk nikam nemíří, ale dvojče s TÍMŽ JMÉNEM existuje, ref se
      // NAVRHNE tady. Konflikt (víc dvojčat téhož jména) se NEŘEŠÍ hádáním: nechá
      // se odložit, protože která ze dvou je ta pravá, je otázka na člověka.
      //
      // ⛔ 2026-09-29 (majitel + Guru, nález z forku): most ref dřív rovnou POTVRZOVAL
      // (state 'confirmed', bez člověka). Shoda JMÉNEM ale identitu nedokazuje —
      // „jméno není identita" (counterparty_resolve) — a potvrzený primary_id cizího
      // zdroje je plný vstup do upsertu dvojčete. Teď jen `proposed` s proveniencí
      // (export, doklad, datum): rozhodne člověk ve frontě identifikace nebo hromadné
      // schválení (twin_ref_tridy, víc zdrojů). Vazba na dvojče níž je taky jen návrh.
      if (!twinId && typeof row.note === 'string') {
        const jmeno = row.note.replace(/^identifikace:\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (jmeno) {
          const shoda = await pg.query<{ id: string }>(
            `SELECT id FROM public.twin_entities
              WHERE label = $1 AND entity_type = 'company' LIMIT 2`,
            [jmeno]
          );
          if (shoda.rows.length === 1) {
            await pg.query(
              `INSERT INTO public.twin_external_refs
                 (twin_id, source, source_key, ref_kind, state, proposed_by, note)
               VALUES ($1::uuid, $2::text, $3::text, 'primary_id', 'proposed', 'li-driver:most', $4::text)
               ON CONFLICT DO NOTHING`,
              [shoda.rows[0]!.id, TWIN_SOURCE, String(row.twin_source_key ?? ''), mostProvenience(jmeno, row, manifest)]
            );
            twinId = shoda.rows[0]!.id;
            counts.bridged += 1;
          }
        }
      }

      if (!twinId) {
        counts.deferred += 1;
        continue;
      }
      await pg.query(
        `SELECT public.twin_identity_propose_binding(
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric, $7::text) AS result`,
        [
          twinId,
          typeof row.source === 'string' ? row.source : sourceOf(manifest),
          String(row.source_key ?? ''),
          String(row.ref_kind ?? 'observed_value'),
          typeof row.proposed_by === 'string' ? row.proposed_by : PROPOSED_BY,
          typeof row.confidence === 'number' ? row.confidence : null,
          typeof row.note === 'string' ? row.note : `export ${manifest.export_id}`,
        ]
      );
      counts.bindings += 1;
    } catch (err) {
      logger.warn({ err }, 'li-driver: promotion binding failed, bundle continues');
    }
  }

  if (counts.deferred > 0) {
    // Loud by design: a silently deferred binding reads as "no identification".
    logger.info(
      { export_id: manifest.export_id, ...counts },
      'li-driver: some promotion bindings target twins that do not exist yet — deferred'
    );
  }
  return counts;
}
