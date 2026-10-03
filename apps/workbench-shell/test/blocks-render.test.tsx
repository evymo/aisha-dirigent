import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GoalProgressBlock, RecordDetailBlock, ReviewQueueBlock, TableBlock } from '@aisha/surface-blocks';

const bundle = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'en', locales: ['en'] },
    snapshot_public_jwk: null,
    preview: { enabled: false }
  },
  i18n: {
    en: {
      'app.provenance.source': 'Source',
      'app.blocks.empty': 'Nothing here yet',
      'app.wb.doc.detail.title': 'Document',
      'app.wb.field.amount': 'Amount',
      'app.wb.field.counterparty': 'Counterparty',
      'app.wb.doctype.contract': 'Contract',
      'app.wb.state.needs_review': 'Needs review',
      'app.wb.confidence': 'Confidence',
      'app.wb.review.obligations.title': 'Obligations',
      'app.wb.action.approve': 'Approve',
      'app.wb.action.reject': 'Reject',
      'app.wb.review.clear': 'All reviewed',
      'app.cols.doc': 'Document'
    }
  }
};

(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = bundle;
const { Block, selectableRowId } = await import('../src/components/blocks.js');

const provenance = { source_slug: 'local-ingest', freshness_at: '2026-07-01T10:00:00Z', trace_id: 'tr1' };

describe('workbench block renderers (key-first, provenance-mandatory)', () => {
  it('renders a record_detail with fields, confidence, status tag, badge, grounded quote and provenance', () => {
    const block: RecordDetailBlock = {
      schema_version: 1,
      block_slug: 'doc_detail',
      block_type: 'record_detail',
      title_key: 'app.wb.doc.detail.title',
      sensitivity: 'confidential',
      provenance,
      data: {
        record_id: 'doc-1',
        badges: ['app.wb.doctype.contract'],
        fields: [
          { key: 'amount', label_key: 'app.wb.field.amount', value: '120000', state: 'needs_review', confidence: 0.82 }
        ],
        quote: 'měsíční nájemné činí 120000 Kč'
      }
    };
    const html = renderToStaticMarkup(<Block block={block} />);
    expect(html).toContain('Amount');
    expect(html).toContain('120000');
    expect(html).toContain('Needs review'); // state tag via i18n key
    expect(html).toContain('82 %'); // confidence
    expect(html).toContain('Contract'); // badge
    expect(html).toContain('local-ingest'); // provenance always visible
    expect(html).toContain('měsíční nájemné'); // grounded quote (runtime data)
  });

  it('renders a review_queue with action buttons (labels via i18n keys)', () => {
    const block: ReviewQueueBlock = {
      schema_version: 1,
      block_slug: 'obl_review',
      block_type: 'review_queue',
      title_key: 'app.wb.review.obligations.title',
      sensitivity: 'confidential',
      provenance,
      data: {
        entity_kind: 'obligation',
        items: [{ id: 'o1', title: 'předat protokol do 5 dnů', state: 'needs_review' }],
        actions: [
          { action_key: 'app.wb.action.approve', decision: 'HUMAN_CONFIRMED', intent: 'approve' },
          { action_key: 'app.wb.action.reject', decision: 'REJECTED', intent: 'reject' }
        ]
      }
    };
    const html = renderToStaticMarkup(<Block block={block} />);
    expect(html).toContain('předat protokol'); // grounded item title
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    // The design language's law, not a class name: ONE Ignition (primary)
    // action per view, everything else secondary. Pinning the spelling
    // `intent-approve` pinned the old bespoke CSS instead — it went green on a
    // button that was styled by nothing at all.
    expect(html.match(/rdl-btn--primary/g) ?? []).toHaveLength(1);
    expect(html).toContain('rdl-btn--secondary');
    expect(html).toContain('local-ingest');
  });

  it('renders an empty review_queue via i18n key (no items)', () => {
    const block: ReviewQueueBlock = {
      schema_version: 1,
      block_slug: 'obl_review',
      block_type: 'review_queue',
      title_key: 'app.wb.review.obligations.title',
      sensitivity: 'confidential',
      provenance,
      data: { entity_kind: 'obligation', items: [], actions: [{ action_key: 'app.wb.action.approve', decision: 'X', intent: 'approve' }] }
    };
    expect(renderToStaticMarkup(<Block block={block} />)).toContain('All reviewed');
  });

  it('makes a document-register row clickable only when it has an id and a handler', () => {
    const table: TableBlock = {
      schema_version: 1,
      block_slug: 'register',
      block_type: 'table',
      title_key: 'app.cols.doc',
      sensitivity: 'internal',
      provenance,
      data: {
        columns: [{ key: 'id', label_key: 'app.cols.doc' }],
        rows: [{ id: 'doc-1' }]
      }
    };
    // Pravidlo se měří NA FUNKCI, ne na značkách. Řádky kreslí `es-table`
    // uvnitř custom elementu a ve statickém renderu nejsou vidět — dřívější
    // `<tr tabindex>` tedy testovalo RDL tabulku, ne tuhle vlastnost. Týž
    // postup, jaký repo zavedlo u `story-loop-mc`: mapování na funkci, render
    // jen doloží, že prvek vznikl a rám sekce drží.
    expect(selectableRowId(table.data.rows, 0, true)).toBe('doc-1');
    expect(selectableRowId(table.data.rows, 0, false), 'bez příjemce = mrtvý ovladač').toBeNull();
    expect(selectableRowId([{ id: '' }], 0, true), 'prázdné id neotevírá neurčito').toBeNull();
    expect(selectableRowId([{}], 0, true), 'řádek bez identity se neotevírá').toBeNull();

    const withHandler = renderToStaticMarkup(<Block block={table} handlers={{ onSelectRecord: () => {} }} />);
    expect(withHandler).toContain('<es-table');
    expect(withHandler).toContain('<es-prov');
  });

  it('renders a goal_progress run with milestones, track position and goal check', () => {
    const gp: GoalProgressBlock = {
      schema_version: 1,
      block_slug: 'wf_progress',
      block_type: 'goal_progress',
      title_key: 'app.blocks.demo.title',
      sensitivity: 'internal',
      provenance,
      data: {
        runs: [{
          batch_id: 'b1', story_id: 's1', title: 'RUN-001 · Demo product',
          pos: 0.67, state: 'transport', total: 3, completed: 2, failed: 0,
          milestones: [
            { code: 'load', name: 'Loading', order: 1, status: 'completed' },
            { code: 'transport', name: 'Transport', order: 2, status: 'completed' },
            { code: 'handover', name: 'Handover', order: 3, status: 'pending' }
          ],
          goal: { met: false, completed: 2, total: 3 }
        }]
      }
    };
    const html = renderToStaticMarkup(<Block block={gp} />);
    expect(html).toContain('RUN-001 · Demo product'); // instance-data title
    // Continuous track position, as a PROPERTY: the run sits somewhere on the
    // oval and the legend states the same share. Pinning `width:67%` pinned the
    // old flat bar — it would have stayed green over a track that ignored `pos`.
    expect(html).toContain('67 %');
    expect(html).toMatch(/class="rdl-circuit__car[^"]*"[^>]*>(?:<title>[^<]*<\/title>)?<circle cx="[\d.]+" cy="[\d.]+"/);
    expect(html).toContain('ms-completed');
    expect(html).toContain('Handover');
    expect(html).toContain('local-ingest');           // provenance always visible
    expect(html).not.toContain('run-goal-met');       // goal not met yet
  });
});
