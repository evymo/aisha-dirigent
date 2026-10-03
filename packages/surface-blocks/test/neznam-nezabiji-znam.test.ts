/**
 * PLOŠNÉ PRAVIDLO: neznámá vlastnost nesmí zabít blok, kterému jinak rozumím.
 *
 * PROČ (naměřeno 2026-08-08 na produkční instanci)
 * -----------------------------------------
 * Kontrakt má `additionalProperties: false` a Ajv je všechno-nebo-nic, takže
 * jedna vlastnost navíc nezneplatnila sebe, ale CELÝ blok:
 *
 *   • čtečka dokladu přidala 2026-08-05 čtyři užitečné klíče (řádkové položky
 *     faktury) ⇒ detail hlásil „Data se nepodařilo načíst" nad 25 poli, která
 *     dorazila v pořádku;
 *   • šest bloků konzole (nj_jednotky, nj_najemci, sm_expiry, sm_identifikace,
 *     pd_recommend, wb_object_tenants) z obrazovky TIŠE zmizelo — a protože
 *     nepřítomnost nikdo nereklamuje, nevědělo se o tom.
 *
 * Opravit ty producenty nestačilo by: příští rozšíření shodí obrazovku znovu.
 * Proto se pravidlo měří TADY, na hranici, a ne u jednotlivých masek.
 *
 * DRUHÁ POLOVINA PRAVIDLA je stejně důležitá: chybějící POVINNÁ vlastnost se
 * odpouštět NESMÍ. Blok bez `record_id` nebo fronta bez `actions` nejde
 * vykreslit ani zpola — tam je odmítnutí správná odpověď.
 */
import { describe, it, expect } from 'vitest';
import { validateBlock } from '../src/validate.js';

/** Platný `record_detail` — základ, do kterého se pak sahá. */
function doklad(): Record<string, unknown> {
  return {
    schema_version: 1,
    block_slug: 'wb_doc_detail',
    block_type: 'record_detail',
    title_key: 'app.wb.doc.detail.title',
    sensitivity: 'confidential',
    provenance: {
      source_slug: 'li-source-registry',
      freshness_at: '2026-08-08T10:00:00Z',
      trace_id: 'doc-detail:doc-1',
    },
    data: { record_id: 'doc-1', fields: [{ key: 'total', label_key: 'app.cols.total' }] },
  };
}

describe('neznámé nezabíjí známé', () => {
  it('blok bez překvapení projde a nehlásí žádný drift', () => {
    const v = validateBlock(doklad());
    expect(v.ok).toBe(true);
    expect(v.degraded, 'čistý blok nesmí nic hlásit — jinak je hlášení šum').toEqual([]);
  });

  it('vlastnost, kterou klient NEZNÁ, blok NESHODÍ a vyjmenuje se', () => {
    const b = doklad();
    (b.data as Record<string, unknown>).cosi_noveho = { a: 1 };
    const v = validateBlock(b);
    expect(v.ok, 'neznámý klíč shodil celý blok — přesně vada z 2026-08-08').toBe(true);
    expect(v.value, 'blok prošel, ale nevrátila se hodnota k vykreslení').toBeTruthy();
    expect(v.degraded).toEqual(['/data/cosi_noveho']);
  });

  it('pravidlo platí v JAKÉKOLI hloubce, ne jen na `data`', () => {
    // Živý nález: `/data/columns/0 must NOT have additional properties`. Kdyby
    // se tolerance uplatnila jen na první úrovni, tenhle případ by dál padal.
    const b = doklad();
    b.block_type = 'table';
    b.data = {
      columns: [{ key: 'a', label_key: 'app.cols.a', cosi: 'navic' }],
      rows: [{ a: '1' }],
    };
    const v = validateBlock(b);
    expect(v.ok, 'neznámá vlastnost uvnitř sloupce shodila celou tabulku').toBe(true);
    expect(v.degraded).toEqual(['/data/columns/0/cosi']);
  });

  it('neznámé se NEODŘEZÁVAJÍ — je to jediný důkaz o driftu, který klient má', () => {
    const b = doklad();
    (b.data as Record<string, unknown>).cosi_noveho = 42;
    const v = validateBlock(b);
    expect((v.value as { data: Record<string, unknown> }).data.cosi_noveho).toBe(42);
  });

  it('chybějící POVINNÁ vlastnost se NEODPOUŠTÍ', () => {
    const b = doklad();
    delete (b.data as Record<string, unknown>).record_id;
    const v = validateBlock(b);
    expect(v.ok, 'blok bez povinného klíče prošel — tolerance přerostla v mlčení').toBe(false);
    expect(v.errors.join(' ')).toMatch(/record_id/);
  });

  it('špatný TYP se NEODPOUŠTÍ', () => {
    const b = doklad();
    (b.data as Record<string, unknown>).fields = 'tohle není pole';
    expect(validateBlock(b).ok).toBe(false);
  });

  it('fronta bez `actions` zůstává vadou — nejde s ní nic udělat', () => {
    const b = doklad();
    b.block_type = 'review_queue';
    b.data = { entity_kind: 'twin_identity', items: [] };
    const v = validateBlock(b);
    expect(v.ok, 'fronta bez akcí je k nekliknutí; tolerovat ji znamená lhát').toBe(false);
  });

  it('`entity_kind` je OTEVŘENÝ slug — nová doména nepotřebuje nové vydání', () => {
    // Platforma vydávala 'twin_identity', uzavřený výčet ho neznal a blok
    // `wb_twin_unmatched` proto na obrazovku nedorazil.
    const b = doklad();
    b.block_type = 'review_queue';
    b.data = {
      entity_kind: 'twin_identity',
      items: [],
      actions: [{ action_key: 'app.twins.action.confirm', decision: 'confirmed', intent: 'approve' }],
    };
    expect(validateBlock(b).ok).toBe(true);
  });

  it('KPI bez naměřené hodnoty smí říct `null` (a není to nula)', () => {
    const b = doklad();
    b.block_type = 'kpi_tile';
    b.data = { value: null };
    expect(validateBlock(b).ok).toBe(true);
  });
});
