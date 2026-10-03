/**
 * Twin producer — entity profiles become PROPOSALS, never confirmed facts.
 *
 * The rules under test are the ones that keep a wrong guess out of the twin graph:
 * a type is derived from catalogued parameters or not at all, an ambiguous profile
 * stays untyped, and everything offered carries its confidence and provenance.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { LiBundle } from '../clients/li-driver.js';
import {
  PROPOSED_BY,
  deriveEntityType,
  pickSourceKey,
  currentValue,
  proposeTwinsFromProfiles,
  replayPromotions,
} from '../clients/twin-producer.js';

const CATALOG = new Map([
  ['customer_id', { code: 'company.ico', entityType: 'company' }],
  ['counterparty', { code: 'company.name', entityType: 'company' }],
  ['vehicle_registration', { code: 'vehicle.plate', entityType: 'vehicle' }],
]);

function profileRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_type: 'entity_profile',
    identity_parameters: ['counterparty', 'customer_id'],
    relational_parameters: ['vehicle_registration'],
    exclusivity: { customer_id: 1.0, counterparty: 0.9 },
    observations: 21,
    confidence: 0.97,
    parameters: {
      customer_id: { values: [{ value: '42196868', support: 0.95 }], stable: true },
      counterparty: { values: [{ value: 'M - SILNICE a.s.', support: 1 }], stable: true },
    },
    documents: ['dn-1', 'dn-2'],
    advisory: true,
    ...over,
  };
}

function bundleWith(rows: Record<string, unknown>[]): LiBundle {
  const dir = mkdtempSync(path.join(tmpdir(), 'twin-producer-'));
  writeFileSync(
    path.join(dir, 'entity_profile_artifact.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  );
  return {
    dir,
    manifest: { export_id: '20260726T010203', engine_version: '1.2.3', source_slug: 'li-dodaky' },
  } as LiBundle;
}

function fakePg(catalogRows: Record<string, string>[] = [...CATALOG].map(([f, e]) => ({
  code: e.code,
  entity_type: e.entityType,
  ingest_field: f,
}))) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('twin_parameter_definitions')) return { rows: catalogRows };
    if (sql.includes('twin_upsert_entity_audited')) {
      return { rows: [{ result: { twin_id: '11111111-2222-3333-4444-555555555555' } }] };
    }
    return { rows: [{ result: {} }] };
  });
  return { pg: { query } as never, calls };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe('deriveEntityType', () => {
  it('lets the parameters decide the type', () => {
    expect(deriveEntityType(['counterparty', 'customer_id'], CATALOG)).toBe('company');
  });

  it('leaves an unrecognised profile untyped rather than guessing', () => {
    expect(deriveEntityType(['meter_serial', 'foo'], CATALOG)).toBeNull();
  });

  it('refuses to break a tie — an ambiguous profile belongs in review', () => {
    expect(deriveEntityType(['customer_id', 'vehicle_registration'], CATALOG)).toBeNull();
  });
});

describe('pickSourceKey', () => {
  it('keys the twin by the most exclusive catalogued parameter', () => {
    const key = pickSourceKey(profileRow(), ['counterparty', 'customer_id'], CATALOG);
    expect(key).toEqual({ param: 'customer_id', value: '42196868' });
  });

  it('is stable when exclusivity ties, so re-runs do not mint duplicates', () => {
    const row = profileRow({ exclusivity: { customer_id: 1.0, counterparty: 1.0 } });
    const first = pickSourceKey(row, ['counterparty', 'customer_id'], CATALOG);
    const second = pickSourceKey(row, ['customer_id', 'counterparty'], CATALOG);
    expect(first).toEqual(second);
  });

  it('ignores parameters the catalog does not know', () => {
    expect(pickSourceKey(profileRow(), ['unknown_field'], CATALOG)).toBeNull();
  });
});

describe('proposeTwinsFromProfiles', () => {
  it('upserts a twin and offers each identity value for confirmation', async () => {
    const { pg, calls } = fakePg();
    const counts = await proposeTwinsFromProfiles(pg, bundleWith([profileRow()]), logger);

    expect(counts).toMatchObject({ twins: 1, bindings: 2, unmapped: 0 });
    const proposals = calls.filter((c) => c.sql.includes('twin_identity_propose_binding'));
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.params).toContain(PROPOSED_BY);
      expect(p.params[1]).toBe('li-dodaky'); // provenance is the bundle's own slug
    }
  });

  it('never confirms anything itself', async () => {
    const { pg, calls } = fakePg();
    await proposeTwinsFromProfiles(pg, bundleWith([profileRow()]), logger);
    expect(calls.some((c) => c.sql.includes('confirm_binding'))).toBe(false);
  });

  it('carries each value its own measured support, not one blanket number', async () => {
    const { pg, calls } = fakePg();
    await proposeTwinsFromProfiles(pg, bundleWith([profileRow()]), logger);
    // params: [twinId, source, value, refKind, proposedBy, confidence, note]
    const byValue = new Map(
      calls
        .filter((c) => c.sql.includes('twin_identity_propose_binding'))
        .map((c) => [c.params[2], c.params[5]])
    );
    expect(byValue.get('42196868')).toBe(0.95);
    expect(byValue.get('M - SILNICE a.s.')).toBe(1);
  });

  it('counts an untypeable profile instead of filing it under a guess', async () => {
    const { pg, calls } = fakePg();
    const row = profileRow({ identity_parameters: ['meter_serial'], parameters: {} });
    const counts = await proposeTwinsFromProfiles(pg, bundleWith([row]), logger);

    expect(counts).toMatchObject({ twins: 0, bindings: 0, unmapped: 1 });
    expect(calls.some((c) => c.sql.includes('twin_upsert_entity_audited'))).toBe(false);
  });

  it('says so out loud when the instance has catalogued no ingest fields', async () => {
    const { pg, calls } = fakePg([]);
    const warn = vi.fn();
    const counts = await proposeTwinsFromProfiles(pg, bundleWith([profileRow()]), {
      info: vi.fn(),
      warn,
      error: vi.fn(),
    } as never);

    expect(counts.unmapped).toBe(1);
    expect(warn).toHaveBeenCalled();
    expect(calls.some((c) => c.sql.includes('twin_upsert_entity_audited'))).toBe(false);
  });

  it('does nothing at all when the bundle carries no profiles', async () => {
    const { pg, calls } = fakePg();
    const counts = await proposeTwinsFromProfiles(pg, bundleWith([]), logger);
    expect(counts).toMatchObject({ twins: 0, bindings: 0, unmapped: 0 });
    expect(calls).toHaveLength(0); // not even the catalog is read
  });
});

describe('replayPromotions — rozhodnutý extrakt se přehrává, neinterpretuje', () => {
  const bundleWithPromotions = (rows: Record<string, unknown>[]): LiBundle => {
    const dir = mkdtempSync(path.join(tmpdir(), 'promotions-'));
    writeFileSync(
      path.join(dir, 'promotions_artifact.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
    );
    return {
      dir,
      manifest: { export_id: 'exp-77', source_slug: 'local-ingest' },
    } as unknown as LiBundle;
  };

  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never;

  it('binding na existující twin se nabídne s JEHO jistotou a proveniencí', async () => {
    const calls: unknown[][] = [];
    const pg = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        if (sql.includes('FROM public.twin_external_refs')) {
          return { rows: [{ twin_id: 'tw-1' }] };
        }
        return { rows: [{ result: {} }] };
      }),
    } as never;
    const counts = await replayPromotions(
      pg,
      bundleWithPromotions([
        {
          record_type: 'twin_promotion', op: 'binding', twin_source_key: 'k1',
          source: 'local-ingest', source_key: 'a'.repeat(64),
          ref_kind: 'identified_tenant', proposed_by: 'local-ingest/tenant_identify',
          confidence: 0.99, advisory: true, note: 'identifikace: X (id)',
        },
      ]),
      logger
    );
    expect(counts.bindings).toBe(1);
    expect(counts.deferred).toBe(0);
    const propose = calls.find(([sql]) => String(sql).includes('twin_identity_propose_binding'));
    expect(propose).toBeDefined();
    const params = propose![1] as unknown[];
    expect(params[0]).toBe('tw-1');
    expect(params[2]).toBe('a'.repeat(64));   // dokument content-addressed
    expect(params[3]).toBe('identified_tenant');
    expect(params[5]).toBe(0.99);             // naměřená jistota, ne 1.0
  });

  it('chybějící twin = odloženo a NAHLAS — nikdy se nevymýšlí', async () => {
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.twin_external_refs')) return { rows: [] };
        if (sql.includes('twin_upsert_entity_audited') || sql.includes('twin_identity_propose_binding')) {
          throw new Error('nesmí se volat');
        }
        return { rows: [] };
      }),
    } as never;
    const counts = await replayPromotions(
      pg,
      bundleWithPromotions([
        { op: 'binding', twin_source_key: 'neexistuje', source_key: 'b'.repeat(64), ref_kind: 'identified_tenant' },
      ]),
      logger
    );
    expect(counts.bindings).toBe(0);
    expect(counts.deferred).toBe(1);
  });

  it('twin_upsert řádky se přehrají PŘED bindingy (tentýž bundle je může cílit)', async () => {
    const poradi: string[] = [];
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('twin_upsert_entity_audited')) {
          poradi.push('upsert');
          return { rows: [{ result: { twin_id: 'tw-9' } }] };
        }
        if (sql.includes('FROM public.twin_external_refs')) {
          poradi.push('lookup');
          return { rows: [{ twin_id: 'tw-9' }] };
        }
        poradi.push('propose');
        return { rows: [{ result: {} }] };
      }),
    } as never;
    const counts = await replayPromotions(
      pg,
      bundleWithPromotions([
        { op: 'binding', twin_source_key: 'k9', source_key: 'v', ref_kind: 'observed_value' },
        { op: 'twin_upsert', entity_type: 'company', source: 'local-ingest', source_key: 'k9', label: 'Vzorová s.r.o.' },
      ]),
      logger
    );
    expect(counts.twins).toBe(1);
    expect(counts.bindings).toBe(1);
    expect(poradi.indexOf('upsert')).toBeLessThan(poradi.indexOf('lookup'));
  });
});

describe('most se doplní sám — cold start nesmí lane umlčet', () => {
  const bundle = (rows: Record<string, unknown>[]): LiBundle => {
    const dir = mkdtempSync(path.join(tmpdir(), 'most-'));
    writeFileSync(path.join(dir, 'promotions_artifact.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return { dir, manifest: { export_id: 'exp-most', source_slug: 'local-ingest' } } as unknown as LiBundle;
  };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never;
  const RADEK = {
    op: 'binding', twin_source_key: 'otisk-1', source_key: 'a'.repeat(64),
    ref_kind: 'identified_tenant', note: 'identifikace: Modrá dílna s.r.o. (ičo+psč)',
  };

  const pgKde = (twiny: { id: string }[], refExistuje = false) => {
    const volani: string[] = [];
    const parametry: unknown[][] = [];
    return {
      volani,
      parametry,
      pg: {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
          volani.push(sql);
          parametry.push(params);
          if (sql.includes('FROM public.twin_external_refs')) {
            return { rows: refExistuje ? [{ twin_id: 'tw-ref' }] : [] };
          }
          if (sql.includes('FROM public.twin_entities')) return { rows: twiny };
          return { rows: [{ result: {} }] };
        }),
      } as never,
    };
  };

  it('otisk nikam nemíří, ale dvojče se stejným jménem existuje → ref se NAVRHNE', async () => {
    const { pg, volani, parametry } = pgKde([{ id: 'tw-7' }]);
    const c = await replayPromotions(pg, bundle([RADEK]), logger);
    expect(c.bridged).toBe(1);
    expect(c.bindings).toBe(1);
    expect(c.deferred).toBe(0);
    const i = volani.findIndex((s) => s.includes('INSERT INTO public.twin_external_refs'));
    expect(i).toBeGreaterThanOrEqual(0);
    // ⛔ Shoda jménem není identita: most NIKDY nepotvrzuje — jen navrhne, s proveniencí.
    expect(volani[i]).toContain("'proposed'");
    expect(volani[i]).not.toContain("'confirmed'");
    expect(volani[i]).not.toContain('confirmed_at');
    expect(String(parametry[i]?.[3])).toMatch(/Modrá dílna s\.r\.o\..*export exp-most.*doklad aaaaaaaaaaaa/);
  });

  it('dvě dvojčata téhož jména = otázka, ne tip — odloží se', async () => {
    const { pg } = pgKde([{ id: 'tw-1' }, { id: 'tw-2' }]);
    const c = await replayPromotions(pg, bundle([RADEK]), logger);
    expect(c.bridged).toBe(0);
    expect(c.deferred).toBe(1);
  });

  it('když otisk míří, most se nezakládá (žádná práce navíc)', async () => {
    const { pg, volani } = pgKde([{ id: 'tw-9' }], true);
    const c = await replayPromotions(pg, bundle([RADEK]), logger);
    expect(c.bridged).toBe(0);
    expect(c.bindings).toBe(1);
    expect(volani.some((s) => s.includes('INSERT INTO public.twin_external_refs'))).toBe(false);
  });
});

/**
 * LABEL = AKTUÁLNÍ JMÉNO (majitel 2026-09-28: uživatel se ptá na aktuální stav, historie
 * nesmí převážit). Naměřeno v produkci: 145 twinů s IČO mělo label jiný než poslední jméno
 * z dokladů — přejmenování udělá jméno NESTABILNÍM a „první stabilní parametr" pak sáhl po
 * IČO nebo adrese; a i stabilní volba brala NEJČASTĚJŠÍ hodnotu, tedy starou.
 */
describe('label twinu = aktuální jméno, ne nejčastější', () => {
  const prejmenovana = profileRow({
    parameters: {
      customer_id: { values: [{ value: '42196868', support: 1 }], stable: true },
      counterparty: {
        stable: false,
        values: [
          { value: 'STARÉ JMÉNO s.r.o.', observations: 40, period: ['2021-01-04', '2024-12-18'] },
          { value: 'NOVÉ JMÉNO s.r.o.', observations: 5, period: ['2025-01-10', '2026-09-01'] },
        ],
      },
    },
  });
  const katalog = (jmenoJeLabel: boolean) => [
    { code: 'company.ico', entity_type: 'company', ingest_field: 'customer_id', label: false },
    { code: 'company.name', entity_type: 'company', ingest_field: 'counterparty', label: jmenoJeLabel },
  ] as unknown as Record<string, string>[];
  const label = (calls: { sql: string; params: unknown[] }[]) =>
    calls.find((c) => c.sql.includes('twin_upsert_entity_audited'))?.params[3];

  it('parametr prohlášený v katalogu za jméno dá label svou NEJNOVĚJŠÍ hodnotou, i když je nestabilní', async () => {
    const { pg, calls } = fakePg(katalog(true));
    await proposeTwinsFromProfiles(pg, bundleWith([prejmenovana]), logger);
    expect(label(calls)).toBe('NOVÉ JMÉNO s.r.o.');
  });

  it('bez deklarace v katalogu platí původní pravidlo (první stabilní parametr) — kontrolní vzorek', async () => {
    const { pg, calls } = fakePg(katalog(false));
    await proposeTwinsFromProfiles(pg, bundleWith([prejmenovana]), logger);
    expect(label(calls)).toBe('42196868');
  });

  it('currentValue: konec období › počet pozorování › pořadí enginu', () => {
    expect(currentValue([
      { value: 'A', observations: 9, period: ['2020-01-01', '2026-01-01'] },
      { value: 'B', observations: 1, period: ['2025-01-01', '2026-03-01'] },
    ])).toBe('B');
    expect(currentValue([
      { value: 'A', observations: 1, period: ['2020-01-01', '2026-03-01'] },
      { value: 'B', observations: 7, period: ['2025-01-01', '2026-03-01'] },
    ])).toBe('B');
    expect(currentValue([{ value: 'A' }, { value: 'B' }])).toBe('A');
    expect(currentValue([])).toBeNull();
  });
});
