/**
 * document-registry-map — turns a source-agnostic DocumentRecord (from a
 * broker source adapter, e.g. Money S5 delivery notes / invoices) into a
 * li_source_registry row, and drives the upsert through the SAME
 * li_upsert_source_registry RPC the li-driver bundle path uses.
 *
 * WHY here (single-writer): li_* is written by ONE lineage — the broker's driver
 * layer — via the li_upsert_* RPCs (SECURITY DEFINER, idempotent on source_sha256).
 * The structured Money pull is a second SOURCE into that same writer, not a second
 * writer: it maps documents to the identical row shape and calls the identical RPC.
 * Telemetry is NOT duplicated here — only documents land in li_* (the twin core
 * owns entities; see `<fork>-digital-twin-vozovy-park`).
 */
import { createHash } from 'node:crypto';
import type { DocumentRecord } from '@aisha/audience-types';

/** The li_source_registry row shape (matches registry_artifact.jsonl / the RPC). */
export interface RegistryRow {
  source_sha256: string;
  source_slug: string;
  story_id: string | null;
  doc_type: string;
  doc_class: string | null;
  filename: string | null;
  status: string;
  missing_required: string[];
  fields: Record<string, unknown>;
  line_items: unknown[];
  schema_version: string;
}

const SCHEMA_VERSION = 'money-s5.doc.v1';

/**
 * Stable IDENTITY hash used as the li_source_registry conflict key. Keyed on the
 * document's identity (externalId, else documentNumber) — NOT its content — so a
 * re-sync of an UPDATED invoice (new status/amount) upserts the SAME row instead
 * of creating a duplicate. This is the persistence-layer complement to the
 * reader's fail-loud anti-double-invoice lookup: one row per invoice, ever.
 */
export function sourceSha256Of(slug: string, doc: DocumentRecord): string {
  const identity = doc.externalId || doc.documentNumber;
  if (!identity) {
    throw new Error('document-registry-map: document has no externalId/documentNumber to key on');
  }
  return createHash('sha256').update(`${slug}\0${identity}`).digest('hex');
}

/**
 * Map one DocumentRecord to a li_source_registry row. Structured fields (financial,
 * party, references) are carried in `fields` so a downstream reader/twin binder can
 * join without re-learning Money's schema; line items go to `line_items`.
 */
export function documentToRegistryRow(
  doc: DocumentRecord,
  opts: { sourceSlug: string; storyId: string | null; docClass?: string | null },
): RegistryRow {
  return {
    source_sha256: sourceSha256Of(opts.sourceSlug, doc),
    source_slug: opts.sourceSlug,
    story_id: opts.storyId,
    doc_type: doc.documentType,
    doc_class: opts.docClass ?? null,
    filename: doc.documentNumber || null,
    status: 'REVIEW',
    missing_required: [],
    fields: {
      document_number: doc.documentNumber,
      document_date: doc.documentDate,
      counterparty: doc.counterparty,
      financial: doc.financial ?? null,
      party: doc.party ?? null,
      references: doc.references ?? null,
    },
    line_items: doc.lines,
    schema_version: SCHEMA_VERSION,
  };
}

/**
 * Injectable seam so the pull→upsert flow is unit-testable without a live DB.
 * The production impl (in the broker wiring) calls adapter.listEntities('document')
 * for `listDocuments` and li_upsert_source_registry via pg for `upsertRegistry`.
 */
export interface DocumentSyncDeps {
  listDocuments(storyId: string): Promise<DocumentRecord[]>;
  upsertRegistry(rows: RegistryRow[]): Promise<number>;
}

/**
 * Pull the documents for one source story and upsert them into li_source_registry.
 * Idempotent by construction (stable source_sha256 per document identity), so a
 * repeated sync updates rows in place — no double invoices. Returns the count the
 * RPC accepted (0 for an empty source, without calling the RPC).
 */
export async function syncDocumentSourceToRegistry(
  deps: DocumentSyncDeps,
  opts: { storyId: string; sourceSlug: string },
): Promise<{ upserted: number }> {
  const docs = await deps.listDocuments(opts.storyId);
  if (docs.length === 0) return { upserted: 0 };
  const rows = docs.map((d) =>
    documentToRegistryRow(d, { sourceSlug: opts.sourceSlug, storyId: opts.storyId }),
  );
  const upserted = await deps.upsertRegistry(rows);
  return { upserted };
}
