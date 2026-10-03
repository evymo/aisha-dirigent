/**
 * CRM LANES — two bundle lanes the evidence layer had no carrier for:
 *
 *   1. RELATIONS  links_artifact rows that name TWINS on both ends
 *                 (`twin_from.source_key`, `twin_to.source_key`) become
 *                 `twin_relations` edges via twin_relation_open_admin.
 *   2. TOUCHES    registry rows with doc_type='communication' + their
 *                 `touch:*` links become `twin_events` on each participant
 *                 (twin_record_events_audited; idempotent on source/type/ref).
 *
 * ⛔ NAMĚŘENO 2026-09-06. Spec (EXTRANET-AUDIENCE-ZADANI rev. 2 §3.4) says a CRM
 * export is an ordinary ingest: accounts = organisation twins, contacts = person
 * twins + relations, activities = communication records. The driver replayed
 * registry / links / obligations / entity profiles — but nothing turned a link
 * into a `twin_relations` row and nothing turned a communication document into
 * a `twin_events` row. A real CRM bundle (hundreds of people and organisations,
 * about a thousand touches) would have produced twins with NO edges and NO timeline: the registry
 * would know everything and the twin would know nothing.
 *
 * DOCTRINE
 *   · A twin is resolved ONLY through a CONFIRMED primary_id reference
 *     (source = bundle source_slug, source_key = the value the twin producer
 *     picked). A link whose end is still a proposal is deferred, not guessed —
 *     the next bundle retries it once the identity was ratified.
 *   · Relations are opened, never invented: an edge already valid for the same
 *     period raises exclusion_violation in the RPC — that is idempotency, not
 *     an error, and is counted as `already`.
 *   · Events carry provenance (source, source_ref = document slug) and NO body:
 *     the message text stays in the registry row; the twin timeline gets the
 *     fact (type, when, with whom).
 */
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Client as PgClient } from 'pg';
import type { LiBundle } from './li-driver.js';
import { readJsonl } from './li-driver.js';

export interface RelationLaneCounts {
  /** Edges opened. */
  opened: number;
  /** Edges already valid for the period (exclusion) — idempotent re-run. */
  already: number;
  /** Rows whose twin on either end has no confirmed identity yet. */
  deferred: number;
  /** Rows with an end whose key belongs to twins of more than one entity type. */
  ambiguous: number;
}

export interface TouchLaneCounts {
  /** Events offered to twin_record_events_audited. */
  events: number;
  /** Communication rows whose participants were all unresolved. */
  orphaned: number;
  /** Touch links whose participant key belongs to twins of more than one entity type. */
  ambiguous: number;
}

const sourceOf = (bundle: LiBundle): string => bundle.manifest.source_slug?.trim() || 'local-ingest';

interface TwinIndex {
  /** (source_key) → twin_id for keys with exactly one confirmed owner. */
  index: Map<string, string>;
  /** Keys held by more than one twin — never guessed, never in `index`. */
  ambiguous: Set<string>;
}

/**
 * One shared lookup per lane: (source_key) → twin_id, confirmed primary_id only.
 *
 * ⛔ 2026-09-27: a confirmed binding is unique per ENTITY TYPE, not per key —
 * a CRM numbers accounts and contacts separately, so account 1001 and person
 * 1001 may both be confirmed under the same source. A bundle's link end carries
 * no entity type, so such a key is NOT guessed: `Map.set` would silently keep
 * whichever row came last and the edge would land on a twin of the wrong kind.
 * It goes to `ambiguous` instead and the lane counts and reports it.
 */
async function loadTwinIndex(pg: PgClient, source: string, keys: Set<string>): Promise<TwinIndex> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  if (keys.size === 0) return { index, ambiguous };
  const res = await pg.query<{ source_key: string; twin_id: string }>(
    `SELECT r.source_key, r.twin_id
       FROM public.twin_external_refs r
      WHERE r.source = $1
        AND r.ref_kind = 'primary_id'
        AND r.state = 'confirmed'
        AND r.valid_to IS NULL
        AND r.source_key = ANY($2::text[])`,
    [source, [...keys]]
  );
  for (const row of res.rows) {
    const known = index.get(row.source_key);
    if (known !== undefined && known !== row.twin_id) ambiguous.add(row.source_key);
    else index.set(row.source_key, row.twin_id);
  }
  for (const key of ambiguous) index.delete(key);
  return { index, ambiguous };
}

function keyOf(end: unknown): string | null {
  const k = (end as { source_key?: unknown } | undefined)?.source_key;
  return typeof k === 'string' && k.trim() !== '' ? k.trim() : null;
}

/** links_artifact rows with twins on both ends → twin_relations. */
export async function openRelationsFromLinks(
  pg: PgClient,
  bundle: LiBundle,
  logger: FastifyBaseLogger
): Promise<RelationLaneCounts> {
  const counts: RelationLaneCounts = { opened: 0, already: 0, deferred: 0, ambiguous: 0 };
  const rows = readJsonl(path.join(bundle.dir, 'links_artifact.jsonl')).filter(
    (r) => keyOf(r.twin_from) && keyOf(r.twin_to) && typeof r.relation === 'string' && !String(r.relation).startsWith('touch:')
  );
  if (rows.length === 0) return counts;
  const source = sourceOf(bundle);
  const keys = new Set<string>();
  for (const r of rows) { keys.add(keyOf(r.twin_from)!); keys.add(keyOf(r.twin_to)!); }
  const { index, ambiguous } = await loadTwinIndex(pg, source, keys);
  for (const r of rows) {
    if (ambiguous.has(keyOf(r.twin_from)!) || ambiguous.has(keyOf(r.twin_to)!)) { counts.ambiguous += 1; continue; }
    const from = index.get(keyOf(r.twin_from)!);
    const to = index.get(keyOf(r.twin_to)!);
    if (!from || !to || from === to) { counts.deferred += 1; continue; }
    const attrs = (r.attrs && typeof r.attrs === 'object' ? r.attrs : {}) as Record<string, unknown>;
    const metadata = { ...attrs, export_id: bundle.manifest.export_id, rule_id: r.rule_id ?? null, source };
    try {
      await pg.query(
        `SELECT public.twin_relation_open_admin($1::uuid, $2::uuid, $3::text, now(), $4::jsonb)`,
        [from, to, String(r.relation), JSON.stringify(metadata)]
      );
      counts.opened += 1;
    } catch (err) {
      // The RPC raises on exclusion_violation with its own message; that is the
      // idempotency signal ("hrana … už v tom období platí"), not a failure.
      const msg = err instanceof Error ? err.message : String(err);
      if (/už v tom období platí|exclusion/i.test(msg)) { counts.already += 1; continue; }
      throw err;
    }
  }
  if (counts.deferred > 0) {
    logger.info({ export_id: bundle.manifest.export_id, ...counts }, 'crm-lanes: relations deferred until identities are confirmed');
  }
  if (counts.ambiguous > 0) {
    // Waiting will not resolve these (unlike `deferred`): the bundle has to
    // name the entity type of the link end.
    logger.warn({ export_id: bundle.manifest.export_id, ...counts }, 'crm-lanes: relations skipped — a twin key belongs to more than one entity type');
  }
  return counts;
}

/** communication registry rows + touch:* links → twin_events per participant. */
export async function recordTouchesAsEvents(
  pg: PgClient,
  bundle: LiBundle,
  logger: FastifyBaseLogger
): Promise<TouchLaneCounts> {
  const counts: TouchLaneCounts = { events: 0, orphaned: 0, ambiguous: 0 };
  const comms = new Map<string, Record<string, unknown>>();
  for (const r of readJsonl(path.join(bundle.dir, 'registry_artifact.jsonl'))) {
    if (r.doc_type === 'communication' && typeof r.source_slug === 'string') comms.set(r.source_slug, r);
  }
  if (comms.size === 0) return counts;
  const touches = readJsonl(path.join(bundle.dir, 'links_artifact.jsonl')).filter(
    (r) => typeof r.relation === 'string' && String(r.relation).startsWith('touch:') && keyOf(r.twin_to)
  );
  const source = sourceOf(bundle);
  const { index, ambiguous } = await loadTwinIndex(pg, source, new Set(touches.map((t) => keyOf(t.twin_to)!)));
  const bySlug = new Map<string, string[]>();
  for (const t of touches) {
    const slug = String((t.from as { source_slug?: string })?.source_slug ?? '');
    if (ambiguous.has(keyOf(t.twin_to)!)) { counts.ambiguous += 1; continue; }
    const twin = index.get(keyOf(t.twin_to)!);
    if (!slug || !twin) continue;
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), twin]);
  }
  const events: Record<string, unknown>[] = [];
  for (const [slug, row] of comms) {
    const twins = [...new Set(bySlug.get(slug) ?? [])];
    if (twins.length === 0) { counts.orphaned += 1; continue; }
    const fields = (row.fields ?? {}) as Record<string, { value?: unknown }>;
    const eventType = String(fields.event_type?.value ?? 'communication');
    const occurredAt = String(fields.created?.value ?? bundle.manifest.created_at ?? '') || null;
    if (!occurredAt) { counts.orphaned += 1; continue; }
    // No body in attrs: the text lives in the registry row (doc slug = source_ref).
    const attrs = {
      subject: fields.subject?.value ?? null,
      status: fields.status?.value ?? null,
      owner: fields.owner?.value ?? null,
      doc_slug: slug,
      export_id: bundle.manifest.export_id,
    };
    for (const twin of twins) {
      events.push({
        event_type: eventType,
        twin_id: twin,
        related_twin_id: twins.find((t) => t !== twin) ?? null,
        story_id: row.story_id ?? null,
        occurred_at: occurredAt,
        attrs,
        source,
        // ⛔ NAMĚŘENO 2026-09-06 nad throwaway DB: twin_record_events_audited
        // deduplikuje přes (source, event_type, source_ref). Se `source_ref = slug`
        // pro VŠECHNY účastníky téhož dokladu zbyl z 1 573 událostí jediný
        // účastník na doklad (981). Ref je proto doklad + dvojče: idempotentní
        // při opakovaném běhu, ale každý účastník má svou událost.
        source_ref: `${slug}#${twin}`,
      });
    }
  }
  if (events.length > 0) {
    await pg.query(`SELECT public.twin_record_events_audited($1::jsonb) AS result`, [JSON.stringify(events)]);
    counts.events = events.length;
  }
  if (counts.orphaned > 0) {
    logger.info({ export_id: bundle.manifest.export_id, ...counts }, 'crm-lanes: touches without a confirmed participant twin were left in the registry only');
  }
  if (counts.ambiguous > 0) {
    logger.warn({ export_id: bundle.manifest.export_id, ...counts }, 'crm-lanes: touch participants skipped — a twin key belongs to more than one entity type');
  }
  return counts;
}
