import type { KpiTileBlock, RecordDetailBlock, ReviewQueueBlock } from '../src/index.js';

const provenance = {
  source_slug: 'demo-source',
  freshness_at: '2026-01-01T00:00:00Z',
  trace_id: 'trace-1'
};

export function makeKpi(over: Partial<KpiTileBlock> = {}): KpiTileBlock {
  return {
    schema_version: 1,
    block_slug: 'demo_kpi',
    block_type: 'kpi_tile',
    title_key: 'app.blocks.demo_kpi.title',
    sensitivity: 'internal',
    provenance,
    data: { value: 42, unit_key: 'app.units.percent', state: 'ok' },
    ...over
  };
}

export function makeRecordDetail(over: Partial<RecordDetailBlock> = {}): RecordDetailBlock {
  return {
    schema_version: 1,
    block_slug: 'doc_detail',
    block_type: 'record_detail',
    title_key: 'app.wb.doc.detail.title',
    sensitivity: 'confidential',
    provenance,
    data: {
      record_id: 'doc-6be0be96d4aa',
      badges: ['app.wb.doctype.contract_amendment', 'app.wb.status.needs_review'],
      fields: [
        {
          key: 'amount',
          label_key: 'app.wb.field.amount',
          value: '130000',
          state: 'auto_pass',
          confidence: 1,
          source_ref: { char_start: 491, char_end: 497, page: null }
        },
        { key: 'counterparty', label_key: 'app.wb.field.counterparty', value: 'Ukázka s.r.o.', state: 'needs_review' }
      ],
      quote: 'Strany se dohodly, že měsíční nájemné nově činí 130000 Kč.'
    },
    ...over
  };
}

export function makeReviewQueue(over: Partial<ReviewQueueBlock> = {}): ReviewQueueBlock {
  return {
    schema_version: 1,
    block_slug: 'obligation_review',
    block_type: 'review_queue',
    title_key: 'app.wb.review.obligations.title',
    sensitivity: 'confidential',
    provenance,
    data: {
      entity_kind: 'obligation',
      items: [
        {
          id: 'obl-1',
          title: 'předat pronajímateli servisní protokol do 5 pracovních dnů',
          subtitle_key: 'app.wb.review.needs_review',
          state: 'needs_review',
          quote: 'Nájemce je povinen předat pronajímateli servisní protokol do 5 pracovních dnů po každém servisu.'
        }
      ],
      actions: [
        { action_key: 'app.wb.action.approve', decision: 'HUMAN_CONFIRMED', intent: 'approve' },
        { action_key: 'app.wb.action.reject', decision: 'REJECTED', intent: 'reject' }
      ]
    },
    ...over
  };
}
