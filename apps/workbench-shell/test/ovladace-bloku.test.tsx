/**
 * Ovladače bloku: deklarace bloku (client_params) → pole ESDK `es-filters`.
 * Náčrtek majitele 2026-09-29 („Smlouvy a nájmy“). Řazení a hledání tabulky testuje
 * ESDK (es-table 0.5, tests/filtry-a-razeni); tady se měří jen mapování hosta.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TableBlock } from '@aisha/surface-blocks';

(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'cs', locales: ['cs'] },
    snapshot_public_jwk: null,
    preview: { enabled: false }
  },
  i18n: { cs: { 'k.mesic': 'Měsíc', 'k.nadrok': 'Jen nad rok', 'k.tridy': 'Třídy', 'app.cols.class.N': 'Nájem', 'app.cols.class.E': 'Energie' } }
};
const { Block, ovladac, poleFiltru } = await import('../src/components/blocks.js');

describe('druh ovladače z deklarace', () => {
  it('pozná druh z typu a UI nápovědy; technické a místní parametry nenabízí', () => {
    expect(ovladac({ type: 'date', ui: 'month' })).toBe('month');
    expect(ovladac({ type: 'int', ui: 'toggle', on: 365 })).toBe('toggle');
    expect(ovladac({ enum: ['N', 'E'], multi: true })).toBe('multi');
    expect(ovladac({ enum: ['a'] })).toBe('enum');
    expect(ovladac('bool')).toBe('bool');
    expect(ovladac('text')).toBe('text');
    expect(ovladac('uuid'), 'id záznamu není ovladač').toBeNull();
    expect(ovladac({ type: 'text', local: true }), 'místní parametr jde jen shellu').toBeNull();
    expect(ovladac({ type: 'int' }), 'číslo bez UI nápovědy se nenabízí').toBeNull();
  });
});

describe('pole pro es-filters', () => {
  it('popisky z překladů, volby výčtu s popisky hodnot, aktuální hodnota a hodnota přepínače', () => {
    const pole = poleFiltru(
      {
        mesic: { type: 'date', ui: 'month', label_key: 'k.mesic' },
        min_days: { type: 'int', ui: 'toggle', on: 365, label_key: 'k.nadrok' },
        tridy: { enum: ['N', 'E'], multi: true, label_key: 'k.tridy', value_label_prefix: 'app.cols.class.' },
        twin_id: 'uuid'
      },
      { mesic: '2026-08-01' }
    );
    expect(pole).toEqual([
      { key: 'mesic', kind: 'month', label: 'Měsíc', value: '2026-08-01' },
      { key: 'min_days', kind: 'toggle', label: 'Jen nad rok', on: 365 },
      { key: 'tridy', kind: 'multi', label: 'Třídy', options: [{ value: 'N', label: 'Nájem' }, { value: 'E', label: 'Energie' }] }
    ]);
  });

  it('blok s deklarací a handlerem vykreslí es-filters nad sebou, bez handleru jako dřív', () => {
    const table = {
      schema_version: 1,
      block_slug: 'sm_overdue',
      block_type: 'table',
      title_key: 't',
      sensitivity: 'internal',
      provenance: { source_slug: 's', freshness_at: '2026-09-29T08:00:00Z', trace_id: 'tr' },
      data: { columns: [{ key: 'label', label_key: 'l' }], rows: [{ id: '1', label: 'Hana' }] },
      ui: { client_params: { mesic: { type: 'date', ui: 'month', label_key: 'k.mesic' } }, search: true },
      params: {}
    } as unknown as TableBlock;
    expect(renderToStaticMarkup(<Block block={table} handlers={{ onBlockParams: () => {} }} />)).toContain('<es-filters');
    expect(renderToStaticMarkup(<Block block={table} />), 'náhled/detail bez handleru nemá filtry').not.toContain('<es-filters');
  });
});
