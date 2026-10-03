/**
 * document-registry-map — DocumentRecord → li_source_registry row + the pull→upsert
 * driver. No DB: the upsert is an injected seam. Focus: the row shape the RPC
 * expects, and the STABLE identity hash that keeps one invoice = one row (the
 * persistence-layer anti-double-invoice guarantee).
 */
import { describe, it, expect } from 'vitest';
import type { DocumentRecord } from '@aisha/audience-types';
import {
  documentToRegistryRow,
  sourceSha256Of,
  syncDocumentSourceToRegistry,
  type DocumentSyncDeps,
  type RegistryRow,
} from '../clients/document-registry-map.js';

const SLUG = 'money-s5-issued-invoices';
const STORY = '11111111-1111-4111-8111-111111111111';

function invoice(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    externalId: '9f2c1e77-aaaa-4bbb-8ccc-000000000001',
    documentNumber: 'FV2026001',
    documentType: 'invoice',
    documentDate: '2026-01-15',
    counterparty: 'DAP. a.s.',
    lines: [{ description: 'Dlažba', quantity: 100, unit: 'm2', catalog: 'DL01', lineTotal: null }],
    financial: { totalAmount: 12100, baseAmount: 10000, vatAmount: 2100, currency: 'CZK', variableSymbol: '2026001', dueDate: '2026-01-29', status: 'Vystaveno', paidDate: null },
    party: { ico: '12345678', dic: 'CZ12345678', email: 'faktury@dap.cz' },
    references: { orderRef: 'OBJ-2026-42', variableSymbol: '2026001' },
    ...overrides,
  };
}

describe('documentToRegistryRow', () => {
  it('maps an invoice to the li_source_registry row shape', () => {
    const row = documentToRegistryRow(invoice(), { sourceSlug: SLUG, storyId: STORY });
    expect(row.source_slug).toBe(SLUG);
    expect(row.story_id).toBe(STORY);
    expect(row.doc_type).toBe('invoice');
    expect(row.filename).toBe('FV2026001');
    expect(row.status).toBe('REVIEW');
    // structured fields carried for downstream join/twin binding
    expect((row.fields.financial as { totalAmount: number, paidDate: null }).totalAmount).toBe(12100);
    expect((row.fields.party as { ico: string }).ico).toBe('12345678');
    expect((row.fields.references as { orderRef: string }).orderRef).toBe('OBJ-2026-42');
    expect(row.fields.document_number).toBe('FV2026001');
    expect(row.line_items).toHaveLength(1);
    expect(row.schema_version).toBe('money-s5.doc.v1');
  });
});

describe('sourceSha256Of — stable identity key (one invoice = one row)', () => {
  it('same document identity → same hash (idempotent upsert)', () => {
    expect(sourceSha256Of(SLUG, invoice())).toBe(sourceSha256Of(SLUG, invoice()));
  });

  it('content change (status/amount) with same identity → SAME hash (updates in place, no duplicate)', () => {
    const a = sourceSha256Of(SLUG, invoice());
    const b = sourceSha256Of(SLUG, invoice({ financial: { totalAmount: 99999, baseAmount: 0, vatAmount: 0, currency: 'CZK', variableSymbol: 'x', dueDate: null, status: 'Zaplaceno', paidDate: null } }));
    expect(b).toBe(a);
  });

  it('different document identity → different hash', () => {
    expect(sourceSha256Of(SLUG, invoice({ externalId: 'other-guid' }))).not.toBe(sourceSha256Of(SLUG, invoice()));
  });

  it('falls back to documentNumber when externalId is empty', () => {
    const h = sourceSha256Of(SLUG, invoice({ externalId: '' }));
    expect(h).toHaveLength(64);
  });

  it('throws when the document has no identity to key on', () => {
    expect(() => sourceSha256Of(SLUG, invoice({ externalId: '', documentNumber: '' }))).toThrow(/no externalId\/documentNumber/);
  });
});

describe('syncDocumentSourceToRegistry — pull → upsert through the single writer', () => {
  function fakeDeps(docs: DocumentRecord[]) {
    const seen: { rows?: RegistryRow[]; listedStory?: string } = {};
    const deps: DocumentSyncDeps = {
      async listDocuments(storyId) { seen.listedStory = storyId; return docs; },
      async upsertRegistry(rows) { seen.rows = rows; return rows.length; },
    };
    return { deps, seen };
  }

  it('maps every pulled document and upserts the batch once', async () => {
    const { deps, seen } = fakeDeps([invoice(), invoice({ externalId: 'g2', documentNumber: 'FV2026002' })]);
    const res = await syncDocumentSourceToRegistry(deps, { storyId: STORY, sourceSlug: SLUG });
    expect(res.upserted).toBe(2);
    expect(seen.rows).toHaveLength(2);
    expect(seen.rows![1].filename).toBe('FV2026002');
    expect(seen.listedStory).toBe(STORY);
  });

  it('empty source → 0 upserted, RPC not called (no empty-batch write)', async () => {
    let called = false;
    const deps: DocumentSyncDeps = {
      async listDocuments() { return []; },
      async upsertRegistry() { called = true; return 0; },
    };
    const res = await syncDocumentSourceToRegistry(deps, { storyId: STORY, sourceSlug: SLUG });
    expect(res.upserted).toBe(0);
    expect(called).toBe(false);
  });
});
