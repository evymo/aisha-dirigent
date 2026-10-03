/**
 * Pruh katalogů — co broker s deklarovanými katalogy adaptéru udělá.
 * Rozhoduje o tom, co se vůbec dostane na plochu: katalog, který se tiše
 * nezavolá, vypadá na ploše stejně jako prázdná komunita.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IDataSource, SourceCatalogRow } from '@aisha/audience-types';
import { declaredCatalogs, syncSourceCatalogs, type CatalogPg } from '../clients/catalog-lane.js';

const CONN = { endpointUrl: '', authMethod: 'pg_dsn', authSecretRef: 'env:X', dataSensitivity: 'internal' };

function adapter(
  catalogs: { kind: string; mode: 'snapshot' | 'series' }[] | undefined,
  list?: (kind: string) => Promise<SourceCatalogRow[]>,
): IDataSource {
  return {
    config: { slug: 'test', displayName: 't', version: '0', capabilities: [], authKind: 'pg_dsn', catalogs },
    initialize: async () => undefined,
    fetchAggregateSnapshots: async function* () { /* nic */ },
    getEntity: async () => ({ entity: null, callerScope: { userId: '', tier: 'guest' as never, allowedReason: '' } }),
    probe: async () => ({ status: 'healthy', checkedAt: '' }),
    shutdown: async () => undefined,
    ...(list ? { listCatalog: list } : {}),
  } as IDataSource;
}

function pg(reply: (kind: string) => object = () => ({ upserted: 1, removed: 0, refused_empty: false })) {
  const calls: unknown[][] = [];
  const client: CatalogPg = {
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      calls.push(params ?? []);
      return { rows: [{ r: reply(String(params?.[1])) }] } as never;
    }),
  };
  return { client, calls };
}

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const row = (id: string): SourceCatalogRow => ({ externalId: id, occurredAt: null, fields: { title: id } });

describe('catalog-lane', () => {
  it('adaptér bez listCatalog: žádné volání jádra, žádná chyba', async () => {
    const { client, calls } = pg();
    const r = await syncSourceCatalogs(adapter([{ kind: 'venue', mode: 'snapshot' }]), CONN, client, 'src', log());
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ kinds: [], upserted: 0, errors: 0 });
  });

  it('volá jen DEKLAROVANÉ katalogy, v pořadí, s režimem a celou dávkou', async () => {
    const list = vi.fn(async (kind: string) => [row(`${kind}-1`), row(`${kind}-2`)]);
    const { client, calls } = pg((kind) => ({ upserted: kind === 'venue' ? 2 : 1, removed: 0, refused_empty: false }));
    const r = await syncSourceCatalogs(
      adapter([{ kind: 'venue', mode: 'snapshot' }, { kind: 'community_kpi', mode: 'series' }], list),
      CONN, client, 'zdroj-a', log());
    expect(list.mock.calls.map((c) => c[0])).toEqual(['venue', 'community_kpi']);
    expect(calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['zdroj-a', 'venue', 'snapshot'],
      ['zdroj-a', 'community_kpi', 'series'],
    ]);
    expect(JSON.parse(String(calls[0][3]))).toEqual([row('venue-1'), row('venue-2')]);
    expect(r.upserted).toBe(3);
    expect(r.errors).toBe(0);
  });

  it('bez deklarace se listCatalog nevolá — deklarace je vypínač', async () => {
    const list = vi.fn(async () => [row('x')]);
    const { client, calls } = pg();
    await syncSourceCatalogs(adapter(undefined, list), CONN, client, 's', log());
    expect(list).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('chyba jednoho katalogu se započítá, ostatní proběhnou', async () => {
    const list = vi.fn(async (kind: string) => {
      if (kind === 'member') throw new Error('permission denied for table core_profile');
      return [row(kind)];
    });
    const { client, calls } = pg();
    const l = log();
    const r = await syncSourceCatalogs(
      adapter([{ kind: 'member', mode: 'snapshot' }, { kind: 'venue', mode: 'snapshot' }], list),
      CONN, client, 's', l);
    expect(r.errors).toBe(1);
    expect(r.kinds[0].error).toMatch(/permission denied/);
    expect(calls.map((c) => c[1])).toEqual(['venue']);
    expect(l.error).toHaveBeenCalled();
  });

  it('odmítnutý prázdný snapshot se hlásí, nepočítá jako chyba a nic se neobchází', async () => {
    const { client, calls } = pg(() => ({ upserted: 0, removed: 0, refused_empty: true }));
    const l = log();
    const r = await syncSourceCatalogs(adapter([{ kind: 'venue', mode: 'snapshot' }], async () => []), CONN, client, 's', l);
    expect(r.kinds[0].refusedEmpty).toBe(true);
    expect(r.errors).toBe(0);
    expect(l.warn).toHaveBeenCalled();
    // broker nikdy nepošle allow_empty=true — je natvrdo false v SQL
    expect(calls).toHaveLength(1);
  });

  it('vadné a duplicitní deklarace se přeskočí a započítají jako chyba', async () => {
    const a = adapter([
      { kind: 'venue', mode: 'snapshot' },
      { kind: 'venue', mode: 'series' },
      { kind: 'Bad-Kind', mode: 'snapshot' },
      { kind: 'ok_kind', mode: 'replace' as never },
    ], async (k) => [row(k)]);
    expect(declaredCatalogs(a)).toEqual([{ kind: 'venue', mode: 'snapshot' }]);
    const r = await syncSourceCatalogs(a, CONN, pg().client, 's', log());
    expect(r.errors).toBe(3);
    expect(r.kinds.map((k) => k.kind)).toEqual(['venue']);
  });
});
