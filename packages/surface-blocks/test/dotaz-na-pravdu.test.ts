/**
 * DOTAZ NA PRAVDU nad nálezy ingestu — kontrakt fronty.
 *
 * PROČ (2026-09-28, produkce): blok „Nálezy" ukazoval jeden řádek na doklad
 * (79× dvě tytéž věty) bez čísel a bez akce. Nálezy se teď slučují po pravidlech
 * do dotazu s příkladem (`get_finding_questions`) a vydávají se jako
 * `review_queue` s druhem `finding`. Druh je CÍL ZÁPISU (uzavřený výčet), takže
 * bez něj by klient celý blok zahodil — přesně vada, kterou kdysi měl
 * `twin_identity`.
 *
 * Tvar níže je výstup `get_finding_questions` změřený na DB (zkrácený na jeden
 * dotaz), ne vymyšlený příklad.
 */
import { describe, it, expect } from 'vitest';
import { validateBlock, validateBlockData } from '../src/validate.js';

function dotazy(): Record<string, unknown> {
  return {
    schema_version: 1,
    block_slug: 'wb_findings',
    block_type: 'review_queue',
    title_key: 'app.wb.blocks.finding_questions.title',
    sensitivity: 'internal',
    provenance: {
      source_slug: 'li-findings',
      freshness_at: '2026-09-28T18:52:19Z',
      trace_id: 'finding-questions',
    },
    data: {
      entity_kind: 'finding',
      items: [
        {
          id: 'ac809723-56eb-0aab-b4e2-c985abfcdbdd',
          title_key: 'app.wb.finding.lines_sum_mismatch',
          subtitle_key: 'app.wb.finding_question.subtitle',
          state: 'needs_review',
          quote: 'Součet řádkových položek = částka bez DPH (±1 na zaokrouhlení)',
          fields: [
            { key: 'documents', label_key: 'app.wb.field.documents', value: 43 },
            {
              key: 'example',
              label_key: 'app.wb.finding_question.example',
              value: 'money-faktura_vydana-VF22337-fddd83e3.json',
            },
            { key: 'lines_sum', label_key: 'app.wb.finding_question.lines_sum', value: 5000 },
            { key: 'amount_without_vat', label_key: 'app.wb.field.amount_without_vat', value: 4132 },
            { key: 'diff', label_key: 'app.wb.finding_question.diff', value: 868 },
          ],
        },
      ],
      actions: [
        { action_key: 'app.wb.finding_question.action.confirm', decision: 'confirmed', intent: 'approve' },
        { action_key: 'app.wb.finding_question.action.reject', decision: 'rejected', intent: 'reject' },
      ],
    },
  };
}

describe('dotaz na pravdu nad nálezy', () => {
  it('fronta druhu `finding` projde kontraktem bez driftu', () => {
    const v = validateBlock(dotazy());
    expect(v.ok, JSON.stringify(v)).toBe(true);
    expect(v.degraded).toEqual([]);
  });

  it('data se poznají jako review_queue (maska podle tvaru)', () => {
    const v = validateBlockData((dotazy() as { data: unknown }).data);
    expect(v).toMatchObject({ ok: true, mask: 'review_queue' });
  });

  it('prázdná fronta je pořád platný blok — „nic k rozhodnutí", ne chyba', () => {
    const b = dotazy();
    (b.data as { items: unknown[] }).items = [];
    expect(validateBlock(b).ok).toBe(true);
  });

  it('fronta bez akcí zůstává vadou — dotaz, na který nejde odpovědět, je zpátky ta stará vada', () => {
    const b = dotazy();
    delete (b.data as Record<string, unknown>).actions;
    expect(validateBlock(b).ok).toBe(false);
  });
});
