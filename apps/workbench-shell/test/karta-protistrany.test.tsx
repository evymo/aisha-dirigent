import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChartBlock, KpiTileBlock, RecordDetailBlock, RelationWebBlock, TableBlock } from '@aisha/surface-blocks';

const bundle = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'cs', locales: ['cs'] },
    snapshot_public_jwk: null,
    preview: { enabled: false },
    workbench: {
      client_id: 'c',
      detail_blocks: ['wb_doc_detail'],
      detail_by_kind: { twin: { param: 'twin_id', blocks: ['wb_twin_detail'] } }
    }
  },
  i18n: {
    cs: {
      'app.web.certainty.confirmed': 'potvrzeno',
      'app.web.certainty.proposed': 'navrženo',
      'app.web.certainty.derived': 'odvozeno',
      'app.units.czk': 'Kč',
      'app.cp.group.companies': 'Naše firmy',
      'app.cp.group.contracts': 'Smlouvy',
      'app.cp.state.overdue': 'po splatnosti',
      'app.cp.trend.invoiced': 'Vyfakturováno',
      'app.cp.trend.paid': 'Z toho uhrazeno',
      'app.cp.aging.not_due': 'nesplatné',
      'app.state.loss': 'ztráta',
      'app.inv.state.overdue': '■ po splatnosti'
    }
  }
};
(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = bundle;
const { Block, relationWebData } = await import('../src/components/blocks.js');
const { composeDetail, detailSlugs } = await import('../src/App.js');

const provenance = { source_slug: 'li-source-registry', freshness_at: '2026-09-23T10:00:00Z', trace_id: 't' };
const base = { schema_version: 1 as const, sensitivity: 'confidential' as const, provenance };

const web: RelationWebBlock = {
  ...base,
  block_slug: 'sm_cp_web',
  block_type: 'relation_web',
  title_key: 'app.cp.blocks.web.title',
  data: {
    center: { label: 'PROFIMAX PRAHA s.r.o.', sub: '26683911' },
    groups: [
      { key: 'companies', label_key: 'app.cp.group.companies', nodes: [
        { id: 't-1', kind: 'twin', label: 'Moravská nemovitostní a.s.', value: 2477943, unit_key: 'app.units.czk', state: 'fault', state_key: 'app.cp.state.overdue', certainty: 'derived' },
        { kind: 'twin', label: 'Slezské kamenolomy a.s.', value: 0, unit_key: 'app.units.czk', certainty: 'derived' }
      ] },
      { key: 'contracts', label_key: 'app.cp.group.contracts', nodes: [
        { id: 'doc-1', kind: 'document', label: 'PP-Profimax.docx', certainty: 'proposed' },
        { id: 'x', kind: 'neznamy_druh', label: 'Něco', certainty: 'proposed' }
      ] }
    ]
  }
};

describe('karta protistrany — síť vazeb (es-web)', () => {
  const canOpen = (k: string): boolean => detailSlugs(k).length > 0;

  it('slova jistoty a skupin jdou z překladu plochy, ne z balíku', () => {
    const d = relationWebData(web, canOpen) as { words: Record<string, string>; groups: { label: string }[] };
    expect(d.words).toEqual({ confirmed: 'potvrzeno', proposed: 'navrženo', derived: 'odvozeno' });
    expect(d.groups.map((g) => g.label)).toEqual(['Naše firmy', 'Smlouvy']);
  });

  it('odkazem je jen uzel, jehož DRUH instance umí otevřít', () => {
    const d = relationWebData(web, canOpen) as { groups: { nodes: { id?: string; label: string }[] }[] };
    const ids = d.groups.flatMap((g) => g.nodes.map((n) => [n.label, n.id ?? null]));
    expect(ids).toEqual([
      ['Moravská nemovitostní a.s.', 't-1'],
      ['Slezské kamenolomy a.s.', null],   // bez twinu — žádný cíl
      ['PP-Profimax.docx', 'doc-1'],   // document jede přes detail_blocks
      ['Něco', null]                       // druh bez detailu = popisek, ne mrtvý odkaz
    ]);
  });

  it('hodnota se formátuje s jednotkou z překladu, stav nese slovo', () => {
    const d = relationWebData(web, canOpen) as { groups: { nodes: { display?: string; stateLabel?: string }[] }[] };
    const n = d.groups[0]!.nodes[0]!;
    expect(n.display).toMatch(/^2\s?477\s?943 Kč$/);
    expect(n.stateLabel).toBe('po splatnosti');
  });

  it('vykreslí es-web; bez skupin prázdný stav, ne prázdný graf', () => {
    expect(renderToStaticMarkup(<Block block={web} handlers={{ onSelectRecord: () => {} }} />)).toContain('<es-web');
    const prazdna = { ...web, data: { center: web.data.center, groups: [] } };
    const html = renderToStaticMarkup(<Block block={prazdna} />);
    expect(html).not.toContain('<es-web');
    expect(html).toContain('<es-empty');
  });
});

describe('grafy přes ESDK', () => {
  it('trend: druhá řada + legenda slovy + součty pod grafem', () => {
    const trend: ChartBlock = {
      ...base, block_slug: 'sm_cp_trend', block_type: 'chart', title_key: 'x',
      data: {
        kind: 'trend', unit_key: 'app.units.czk',
        legend_keys: ['app.cp.trend.invoiced', 'app.cp.trend.paid'],
        points: [{ label: '2026-07', value: 100 }, { label: '2026-08', value: 200 }],
        compare: [{ label: '2026-07', value: 100 }, { label: '2026-08', value: 50 }]
      }
    };
    const html = renderToStaticMarkup(<Block block={trend} />);
    expect(html).toContain('<es-trend');
    expect(html).toContain('compare="100,50"');
    expect(html).toContain('Vyfakturováno|Z toho uhrazeno');
    expect(html).toContain('2026-07 – 2026-08');
  });

  it('bar: pásmo nese stav (es-hbar), popisek z klíče má přednost', () => {
    const bar: ChartBlock = {
      ...base, block_slug: 'sm_cp_aging', block_type: 'chart', title_key: 'x',
      data: { kind: 'bar', unit_key: 'app.units.czk', points: [
        { label: '≤ 0', label_key: 'app.cp.aging.not_due', value: 10, pct: 10, state: 'ok' },
        { label: '365+', value: 90, pct: 90, state: 'loss' }] }
    };
    expect(renderToStaticMarkup(<Block block={bar} />)).toContain('<es-hbar');
  });
});

describe('detail skládá kartu: fakta → čísla v řádku → zbytek', () => {
  it('KPI jdou do mřížky, pořadí ostatních drží deklaraci', () => {
    const card: RecordDetailBlock = { ...base, block_slug: 'card', block_type: 'record_detail', title_key: 'x', data: { record_id: '1', fields: [] } };
    const k = (slug: string): KpiTileBlock => ({ ...base, block_slug: slug, block_type: 'kpi_tile', title_key: 'x', data: { value: 1 } });
    const tab: TableBlock = { ...base, block_slug: 'tab', block_type: 'table', title_key: 'x', data: { columns: [], rows: [] } };
    const html = renderToStaticMarkup(<>{composeDetail([card, k('k1'), web, k('k2'), tab], {})}</>);
    const grid = html.indexOf('wb-kpigrid');
    expect(grid).toBeGreaterThan(html.indexOf('record-detail'));
    expect(html.indexOf('<es-web')).toBeGreaterThan(grid);
    expect(html.indexOf('<es-table')).toBeGreaterThan(html.indexOf('<es-web'));
  });
});

describe('karta podle prototypu Modernizace: dva sloupce, dotaz, štítek stavu', () => {
  const card: RecordDetailBlock = { ...base, block_slug: 'card', block_type: 'record_detail', title_key: 'x', data: { record_id: '1', fields: [{ key: 'nazev', label_key: 'x', value: 'PROFIMAX PRAHA s.r.o.' }] } };
  const kpi: KpiTileBlock = { ...base, block_slug: 'k1', block_type: 'kpi_tile', title_key: 'x', data: { value: 1 } };
  const graf: ChartBlock = { ...base, block_slug: 'g', block_type: 'chart', title_key: 'x', data: { kind: 'bar', points: [{ label: '365+', value: 1 }] } };
  const tab: TableBlock = { ...base, block_slug: 'tab', block_type: 'table', title_key: 'x', data: { columns: [], rows: [] } };

  it('grafy jdou do postranního sloupce, tabulky a síť do hlavního', () => {
    const html = renderToStaticMarkup(<>{composeDetail([card, kpi, tab, web, graf], {})}</>);
    const main = html.indexOf('wb-cols__main'), side = html.indexOf('wb-cols__side');
    expect(main).toBeGreaterThan(-1);
    expect(html.indexOf('<es-table')).toBeGreaterThan(main);
    expect(html.indexOf('<es-web')).toBeGreaterThan(main);
    expect(html.indexOf('<es-web')).toBeLessThan(side);
    expect(html.indexOf('<es-hbar')).toBeGreaterThan(side);
  });

  it('bez grafu zůstane jeden sloupec (prázdný pruh by byl okraj, ne obsah)', () => {
    expect(renderToStaticMarkup(<>{composeDetail([card, kpi, tab], {})}</>)).not.toContain('wb-cols');
  });

  it('dotaz se vloží pod fakta a jméno se bere z karty', async () => {
    const { recordName } = await import('../src/App.js');
    expect(recordName([card, kpi])).toBe('PROFIMAX PRAHA s.r.o.');
    expect(recordName([kpi])).toBeNull();
    const html = renderToStaticMarkup(<>{composeDetail([card, kpi], {}, <div className="test-ask" />)}</>);
    expect(html.indexOf('test-ask')).toBeGreaterThan(html.indexOf('record-detail'));
    expect(html.indexOf('test-ask')).toBeLessThan(html.indexOf('wb-kpigrid'));
  });
});

describe('tabulka: sloupec s value_keys se překládá', () => {
  it('buňka je klíč → vykreslí se slovo z překladu', () => {
    const t1: TableBlock = { ...base, block_slug: 'inv', block_type: 'table', title_key: 'x', data: {
      columns: [{ key: 'stav', label_key: 'app.cols.state', value_keys: true }, { key: 'cislo', label_key: 'x' }],
      rows: [{ id: 'd1', stav: 'app.inv.state.overdue', cislo: 'app.inv.state.overdue' }] } };
    const html = renderToStaticMarkup(<Block block={t1} />);
    expect(html).toContain('<es-table');
  });
});
