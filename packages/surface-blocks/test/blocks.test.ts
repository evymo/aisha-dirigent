import { describe, expect, it } from 'vitest';
import {
  assertCacheable,
  assertRenderable,
  validateBlock,
  validateLayout,
  type SurfaceBlock
} from '../src/index.js';
import { makeKpi, makeRecordDetail, makeReviewQueue } from './fixtures.js';

describe('block schema', () => {
  it('accepts a valid kpi_tile', () => {
    expect(validateBlock(makeKpi()).ok).toBe(true);
  });

  it('accepts a valid table / timeline / alert_feed / narrative', () => {
    const base = makeKpi();
    const blocks: SurfaceBlock[] = [
      {
        ...base,
        block_slug: 'demo_table',
        block_type: 'table',
        data: {
          columns: [{ key: 'name', label_key: 'app.cols.name' }, { key: 'v', label_key: 'app.cols.value', align: 'right' }],
          rows: [{ name: 'a', v: 1 }, { name: 'b', v: null }]
        }
      },
      {
        ...base,
        block_slug: 'demo_timeline',
        block_type: 'timeline',
        data: { items: [{ at: '2026-03-01T00:00:00Z', label: 'runtime text', state: 'warning' }] }
      },
      {
        ...base,
        block_slug: 'demo_alerts',
        block_type: 'alert_feed',
        data: { items: [{ id: 'a1', kind_key: 'app.alerts.due_tomorrow', at: '2026-03-01T00:00:00Z', severity: 'critical' }] }
      },
      {
        ...base,
        block_slug: 'demo_narrative',
        block_type: 'narrative',
        data: { markdown: 'Grounded narrative from story loop.' }
      }
    ];
    for (const b of blocks) {
      const r = validateBlock(b);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('accepts a valid record_detail (document-management workbench)', () => {
    const r = validateBlock(makeRecordDetail());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts a valid review_queue (příprava / preparation)', () => {
    const r = validateBlock(makeReviewQueue());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('rejects a review_queue with no actions (empty actions is meaningless)', () => {
    const b = makeReviewQueue();
    b.data.actions = [];
    expect(validateBlock(b).ok).toBe(false);
  });

  it('rejects a review_queue with an unknown entity_kind (fail-closed dispatch target)', () => {
    const b = makeReviewQueue() as Record<string, unknown>;
    (b.data as { entity_kind: string }).entity_kind = 'invoice_line';
    expect(validateBlock(b).ok).toBe(false);
  });

  it('rejects a record_detail field carrying both an unknown state and extra keys', () => {
    const b = makeRecordDetail();
    (b.data.fields[0] as Record<string, unknown>).state = 'sort_of_ok';
    expect(validateBlock(b).ok).toBe(false);
  });

  it('accepts record_detail and review_queue in a workbench layout', () => {
    expect(
      validateLayout({
        schema_version: 1,
        surface: 'workbench',
        blocks: [
          { block_slug: 'doc_detail', block_type: 'record_detail', title_key: 'app.wb.doc.detail.title', position: 0 },
          { block_slug: 'obligation_review', block_type: 'review_queue', title_key: 'app.wb.review.obligations.title', position: 1 }
        ]
      }).ok
    ).toBe(true);
  });

  it('presentation is an optional arrangement hint on a layout block', () => {
    const layout = (extra: Record<string, unknown>) => validateLayout({
      schema_version: 1,
      surface: 'vyvoz',
      blocks: [
        { block_slug: 'queue', block_type: 'review_queue', title_key: 'app.wb.q', position: 0, ...extra }
      ]
    });
    // declared → valid; absent → valid (older bundles keep working)
    expect(layout({ presentation: 'tape' }).ok).toBe(true);
    expect(layout({}).ok).toBe(true);
    // an EMPTY hint is a config mistake, not a silent default
    expect(layout({ presentation: '' }).ok).toBe(false);
    // null must never appear on the wire (get_surface_layout strips it) — an old
    // shell without this field would otherwise drop the WHOLE layout
    expect(layout({ presentation: null }).ok).toBe(false);
  });

  it('accepts all three chart kinds over one uniform points shape', () => {
    const base = makeKpi();
    const chart = (kind: string, over: Record<string, unknown> = {}) => ({
      ...base,
      block_slug: `demo_${kind}`,
      block_type: 'chart',
      data: { kind, points: [{ label: '2026-07', value: 12.5, pct: 40 }], ...over }
    });
    for (const b of [chart('trend', { target: 20 }), chart('bar'), chart('donut')]) {
      const r = validateBlock(b);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('rejects an unknown chart kind — kind names a renderer, so it stays closed', () => {
    const b = { ...makeKpi(), block_type: 'chart', data: { kind: 'sankey', points: [] } };
    expect(validateBlock(b).ok).toBe(false);
  });

  it('rejects a chart point outside 0-100 pct, and one missing its value', () => {
    const mk = (points: unknown[]) => ({ ...makeKpi(), block_type: 'chart', data: { kind: 'bar', points } });
    expect(validateBlock(mk([{ label: 'a', value: 1, pct: 140 }])).ok).toBe(false);
    expect(validateBlock(mk([{ label: 'a' }])).ok).toBe(false);
  });

  it('rejects a block without provenance (mandatory)', () => {
    const b = makeKpi() as Record<string, unknown>;
    delete b.provenance;
    expect(validateBlock(b).ok).toBe(false);
  });

  it('rejects unknown block_type — a renderer cannot be sent over the wire', () => {
    expect(validateBlock({ ...makeKpi(), block_type: 'gauge' }).ok).toBe(false);
  });

  /**
   * ZMĚNA CHOVÁNÍ 2026-08-08, vědomá — dřív tenhle případ padal spolu s tím,
   * co je nad ním.
   *
   * Neznámá VLASTNOST už blok nezabíjí: hlásí se v `degraded` a blok se vykreslí
   * bez ní. Důvod je naměřený, ne teoretický — čtečka dokladu přidala čtyři
   * užitečné klíče a od té chvíle detail faktury hlásil „Data se nepodařilo
   * načíst" nad 25 poli, která dorazila v pořádku; týmž způsobem tiše zmizelo
   * šest bloků konzole. Uzavřenost schématu se tím NERUŠÍ, jen se přesouvá tam,
   * kde je užitečná: brány v CI drift dál vidí a mají ho opravit, ale uživatel
   * kvůli němu nepřijde o obsah, kterému klient rozumí.
   *
   * Neznámý TYP zůstává fatální (test výš) — ten pojmenovává renderer, který
   * klient buď má, nebo nemá.
   */
  it('unknown extra property is REPORTED, not fatal', () => {
    const r = validateBlock({ ...makeKpi(), extra: 1 });
    expect(r.ok, 'neznámá vlastnost shodila blok, kterému klient jinak rozumí').toBe(true);
    expect(r.degraded, 'blok prošel, ale drift se nikam nenahlásil').toEqual(['//extra']);
  });

  // The OPEN/CLOSED boundary of the contract — the property, not a spelling:
  //  • `surface` is a SECTION and sections are DATA the backend serves. The
  //    client must accept any section name it has never heard of — a new
  //    section is a row, not a bundle release. (An enum here once made the
  //    bundle the authority over the backend; JSON Schema is all-or-nothing,
  //    so one unknown section dropped the WHOLE layout.)
  //  • `block_type` names a renderer. A renderer cannot be sent over the
  //    wire, so that side stays a closed catalog and unknown values fail.
  it('accepts any non-empty section, because sections are backend data', () => {
    for (const section of ['mobile', 'porada', 'ask', 'registry', 'section_invented_after_this_bundle_shipped']) {
      const r = validateLayout({
        schema_version: 1,
        surface: section,
        blocks: [{ block_slug: 'demo_kpi', block_type: 'kpi_tile', title_key: 'app.blocks.demo_kpi.title', position: 0 }]
      });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('rejects an empty section name but NOT an unknown one; the closed side stays block_type', () => {
    expect(validateLayout({ schema_version: 1, surface: '', blocks: [] }).ok).toBe(false);
    expect(
      validateLayout({
        schema_version: 1,
        surface: 'porada',
        blocks: [{ block_slug: 'x', block_type: 'renderer_the_client_does_not_have', title_key: 'app.x', position: 0 }]
      }).ok
    ).toBe(false);
  });
});

describe('sensitivity gating (fail-closed)', () => {
  it('renders within cap, throws above cap', () => {
    expect(() => assertRenderable(makeKpi({ sensitivity: 'internal' }), 'restricted')).not.toThrow();
    expect(() => assertRenderable(makeKpi({ sensitivity: 'confidential' }), 'restricted')).toThrow();
  });

  it('treats UNKNOWN sensitivity as not renderable (fail-closed)', () => {
    const b = makeKpi({ sensitivity: 'top-secret' as never });
    expect(() => assertRenderable(b, 'confidential')).toThrow();
  });

  it('never allows confidential into client cache', () => {
    expect(() => assertCacheable(makeKpi({ sensitivity: 'confidential' }))).toThrow();
    expect(() => assertCacheable(makeKpi({ sensitivity: 'restricted' }))).not.toThrow();
  });
});

describe('action_form: klíč pole smí camelCase (2026-09-27, připojení AVP `baseUrl`)', () => {
  const akce = (key: string) => ({
    schema_version: 1,
    block_slug: 'adm_zdroje_akce',
    block_type: 'action_form',
    title_key: 'block.admin.zdroje_akce',
    sensitivity: 'internal',
    provenance: makeKpi().provenance,
    data: {
      target_kind: 'none',
      target_id: null,
      actions: [{ slug: 'zdroj.avp.pripojeni', title_key: 'a.t', fields: [{ key, label_key: 'a.f', type: 'text', required: true }] }],
    },
  });
  it('camelCase i snake_case projdou', () => {
    expect(validateBlock(akce('baseUrl') as never).ok).toBe(true);
    expect(validateBlock(akce('database') as never).ok).toBe(true);
    expect(validateBlock(akce('p_source_slug') as never).ok).toBe(true);
  });
  it('klíč nezačínající písmenem nebo se znaky mimo [a-zA-Z0-9_] neprojde', () => {
    expect(validateBlock(akce('1url') as never).ok).toBe(false);
    expect(validateBlock(akce('base-url') as never).ok).toBe(false);
    expect(validateBlock(akce('base url') as never).ok).toBe(false);
  });
});
