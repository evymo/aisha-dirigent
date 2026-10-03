/**
 * AVP → obecná surová dráha: co se zapíše, jakým druhem a režimem, s jakým kurzorem.
 *
 * Měří se skutečný index.ts nad podvrženým ctx (fetch = portál, rpc = DB, kv =
 * kurzory). Hlídá se:
 *   · zápis jde JEN přes audience_sync_source_catalog pod jménem zdroje
 *     `avp-portal` — žádné dvojče (rozhodnutí majitele 2026-09-24), žádná
 *     tabulka dodavatele v jádru (majitel 2026-09-26: „vše jako plugin"),
 *   · číselník = snapshot v JEDNÉ dávce, výdej a nádrže = series,
 *   · výdej ukládá VŠECHNY verze i skryté (platnost rozhoduje čtenář),
 *   · kurzor výdeje = nejpozdější VIDĚNÝ serverSyncTime, ne „teď",
 *   · kurzor nádrží jde zpět o 48 h (pozdě zapsaný návoz se nepřeskočí),
 *   · rozvrh deklaruje capability z manifestu, ne callback,
 *   · po číselníku NÁVRHY vazeb, po výdeji PROJEKCE na dvojčata — a jejich
 *     selhání nemlčí: uložené zůstane, běh ale skončí chybou se zprávou.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { init, syncFleet, syncFuelings, syncTanks } from '../index.js';
import { mapFueling, nejpozdeji } from '../mappers.js';

type Volani = { fn: string; args: Record<string, unknown> };
type Radek = { externalId: string; occurredAt: string | null; fields: Record<string, unknown> };

function podvrzenyCtx(
  odpovedi: Record<string, unknown[]>,
  kv: Record<string, unknown> = {},
  selze?: string,
  vratiRpc: Record<string, unknown> = {},
) {
  const rpc: Volani[] = [];
  const url: string[] = [];
  const rozvrhy: Array<[string, string]> = [];
  const ctx = {
    plugin: { version: '0.2.0' },
    tenant: { id: 't' },
    config: { baseUrl: 'https://vzorova.avp-portal.cz', database: 'vzorova', username: 'u', password: 'p', pageSize: 2000 },
    log: () => undefined,
    fetch: async (u: string) => {
      url.push(u);
      if (u.endsWith('/api/signin')) return new Response(JSON.stringify({ token: 'tok', user: { ownership: 'x', id: 1 } }));
      const zdroj = Object.keys(odpovedi).find((k) => u.includes(`/api/vzorova/${k}?`));
      return new Response(JSON.stringify(zdroj ? odpovedi[zdroj] : []));
    },
    kv: {
      get: async (k: string) => kv[k] ?? null,
      set: async (k: string, v: unknown) => { kv[k] = v; },
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpc.push({ fn, args });
      if (fn === selze) throw new Error(`${fn} vybuchlo`);
      if (fn in vratiRpc) return vratiRpc[fn];
      return { upserted: 0 };
    },
    schedule: (cron: string, cap: string) => { rozvrhy.push([cron, cap]); },
  };
  return { ctx, rpc, url, kv, rozvrhy };
}

const dotaz = (url: string[], zdroj: string) => decodeURIComponent(url.find((u) => u.includes(`/${zdroj}?`)) ?? '');

describe('AVP → obecná surová dráha', () => {
  it('číselník: karty, nádrže i čipy jako snapshot pod zdrojem avp-portal, pak návrhy vazeb', async () => {
    const { ctx, rpc } = podvrzenyCtx({
      cards: [{ id: 7, name: 'Řidič A', cardType: 'Driver' }, { id: 0, name: 'bez id' }],
      tanks: [{ id: 3, name: 'Nádrž 1', maximumVolume: 10000 }],
      chips: [{ chipCode: 'a1b2c3d4e5f60718', cardId: 7 }, { chipCode: '', cardId: 7 }, { chipCode: 'ffff', cardId: 0 }],
    });
    expect(await syncFleet(ctx)).toEqual({ cards: 1, tanks: 1, chips: 1, identity: { upserted: 0 } });
    expect(rpc.map((v) => [v.fn, v.args.p_source_slug, v.args.p_kind, v.args.p_mode])).toEqual([
      ['audience_sync_source_catalog', 'avp-portal', 'card', 'snapshot'],
      ['audience_sync_source_catalog', 'avp-portal', 'tank', 'snapshot'],
      ['audience_sync_source_catalog', 'avp-portal', 'chip', 'snapshot'],
      // návrhy až nad ULOŽENÝM číselníkem
      ['avp_propose_identity', undefined, undefined, undefined],
    ]);
    const karty = rpc[0].args.p_rows as Radek[];
    expect(karty).toEqual([{
      externalId: '7', occurredAt: null,
      fields: { item_number: null, name: 'Řidič A', card_type: 'Driver', inventory_number: null, vehicle_type: null },
    }]);
    // Kód čipu je klíč: velkými písmeny, stejně jako ve výdeji ('cip:' v SQL adaptérech).
    expect(rpc[2].args.p_rows).toEqual([{ externalId: 'A1B2C3D4E5F60718', occurredAt: null, fields: { chip_code: 'A1B2C3D4E5F60718', card_id: 7 } }]);
  });

  it('číselník: selhání návrhů NEmlčí — katalog zůstane uložený, běh skončí chybou se zprávou', async () => {
    const { ctx, rpc } = podvrzenyCtx({ cards: [{ id: 7, name: 'Řidič A', cardType: 'Driver' }], tanks: [], chips: [] }, {}, 'avp_propose_identity');
    await expect(syncFleet(ctx)).rejects.toThrow(/číselník uložen, ale návrhy vazeb identity selhaly: avp_propose_identity vybuchlo/);
    expect(rpc.filter((v) => v.fn === 'audience_sync_source_catalog').map((v) => v.args.p_kind)).toEqual(['card', 'tank', 'chip']);
  });

  it('pole řádků jsou jen skaláry (katalog vnořené hodnoty odmítne celou dávku)', async () => {
    const { ctx, rpc } = podvrzenyCtx({
      fuelings: [{ id: 1, time: '2026-09-25T10:00:00Z', liters: 50, serverSyncTime: '2026-09-25T10:10:00Z', extra: { vnoreny: true } }],
    });
    await syncFuelings(ctx);
    for (const r of rpc[0].args.p_rows as Radek[]) {
      for (const v of Object.values(r.fields)) expect(['string', 'number', 'boolean']).toContain(v === null ? 'string' : typeof v);
    }
  });

  it('výdej: series; uloží všechny verze i skryté; kurzor = nejpozdější viděný serverSyncTime', async () => {
    const { ctx, rpc, kv } = podvrzenyCtx(
      {
        fuelings: [
          { id: 1, time: '2026-09-25T10:00:00Z', liters: 50, parentId: null, hidden: false, removed: false, serverSyncTime: '2026-09-25T10:10:00Z' },
          { id: 2, time: '2026-09-25T10:00:00Z', liters: 55, parentId: 1, hidden: false, removed: false, serverSyncTime: '2026-09-25T11:30:00Z' },
          { id: 3, time: '2026-09-25T12:00:00Z', liters: 0, parentId: null, hidden: true, removed: false, serverSyncTime: '2026-09-25T12:05:00Z' },
        ],
      },
      { 'avp:fueling-cursor': '2026-09-25T09:00:00Z' },
    );
    expect(await syncFuelings(ctx)).toMatchObject({ fetched: 3, written: 3, cursor: '2026-09-25T12:05:00Z' });
    expect([rpc[0].args.p_kind, rpc[0].args.p_mode]).toEqual(['fueling', 'series']);
    const radky = rpc[0].args.p_rows as Radek[];
    expect(radky.map((r) => [r.externalId, r.occurredAt, r.fields.parent_id, r.fields.hidden])).toEqual([
      ['1', '2026-09-25T10:00:00Z', null, false],
      ['2', '2026-09-25T10:00:00Z', 1, false],
      ['3', '2026-09-25T12:00:00Z', null, true],
    ]);
    expect(kv['avp:fueling-cursor']).toBe('2026-09-25T12:05:00Z');
  });

  it('výdej: po zápisu projekce na dvojčata (i bez nových výdejů — mohla přibýt potvrzená vazba)', async () => {
    const { ctx, rpc } = podvrzenyCtx({ fuelings: [] }, { 'avp:fueling-cursor': '2026-09-25T09:00:00Z' });
    await syncFuelings(ctx);
    expect(rpc).toEqual([{ fn: 'avp_project_fuelings', args: { p_okno_min: 180 } }]);
  });

  it('výdej: selhání projekce NEmlčí — výdeje i kurzor zůstanou, běh skončí chybou se zprávou', async () => {
    const { ctx, rpc, kv } = podvrzenyCtx(
      { fuelings: [{ id: 1, time: '2026-09-25T10:00:00Z', liters: 50, serverSyncTime: '2026-09-25T10:10:00Z' }] },
      { 'avp:fueling-cursor': '2026-09-25T09:00:00Z' },
      'avp_project_fuelings',
    );
    await expect(syncFuelings(ctx)).rejects.toThrow(/výdej uložen, ale projekce na dvojčata selhala: avp_project_fuelings vybuchlo/);
    expect(rpc[0].args.p_kind).toBe('fueling');
    expect(kv['avp:fueling-cursor']).toBe('2026-09-25T10:10:00Z');
  });

  it('výdej: chyba vrácená jako OBJEKT (ne výjimka) taky nemlčí', async () => {
    const { ctx, kv } = podvrzenyCtx(
      { fuelings: [{ id: 1, time: '2026-09-25T10:00:00Z', liters: 50, serverSyncTime: '2026-09-25T10:10:00Z' }] },
      { 'avp:fueling-cursor': '2026-09-25T09:00:00Z' },
      undefined,
      { avp_project_fuelings: { error: { code: '42501', message: 'permission denied' } } },
    );
    await expect(syncFuelings(ctx)).rejects.toThrow(/projekce na dvojčata selhala: \{"code":"42501","message":"permission denied"\}/);
    expect(kv['avp:fueling-cursor']).toBe('2026-09-25T10:10:00Z');
  });

  it('výdej: prázdná odpověď kurzor NEposune (ne na „teď")', async () => {
    const { ctx, kv } = podvrzenyCtx({ fuelings: [] }, { 'avp:fueling-cursor': '2026-09-25T09:00:00Z' });
    await syncFuelings(ctx);
    expect(kv['avp:fueling-cursor']).toBe('2026-09-25T09:00:00Z');
  });

  it('výdej: dotaz filtruje podle serverSyncTime od kurzoru a stránkuje (limit + sort=id)', async () => {
    const { ctx, url } = podvrzenyCtx({ fuelings: [] }, { 'avp:fueling-cursor': '2026-09-25T09:00:00Z' });
    await syncFuelings(ctx);
    const q = dotaz(url, 'fuelings');
    expect(q).toContain('serverSyncTime=2026-09-25T09:00:00Z...');
    expect(q).toMatch(/limit=2000/);
    expect(q).toMatch(/sort=id/);
  });

  it('nádrže: návoz a uzávěrka každý svým druhem (series); dotaz jde 48 h před kurzor', async () => {
    const { ctx, rpc, url, kv } = podvrzenyCtx(
      {
        'tank-refills': [{ id: 11, time: '2026-09-24T08:00:00Z', amount: 5000, type: 'Refill', tankId: 3 }],
        'tank-registers': [{ id: 21, time: '2026-09-24T21:59:59Z', tankId: 3, calculatedTankAmount: 8000, dispendedAmount: 900 }],
      },
      { 'avp:tank-cursor': '2026-09-25T00:00:00Z' },
    );
    expect(await syncTanks(ctx)).toMatchObject({ refills: 1, registers: 1 });
    expect(rpc.map((v) => [v.args.p_kind, v.args.p_mode])).toEqual([['tank_refill', 'series'], ['tank_register', 'series']]);
    expect((rpc[1].args.p_rows as Radek[])[0].fields.dispensed_amount).toBe(900);
    expect(dotaz(url, 'tank-refills')).toContain('time=2026-09-23T00:00:00.000Z...');
    // Kurzor se nevrací zpět: vidět jsme jen starší záznamy než uložený kurzor.
    expect(kv['avp:tank-cursor']).toBe('2026-09-25T00:00:00Z');
  });

  it('rozvrh deklaruje capability z manifestu; politika sandboxu povoluje katalog a dvě RPC dvojčat', async () => {
    const { ctx, rozvrhy } = podvrzenyCtx({});
    await init(ctx);
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../manifest.json', import.meta.url)), 'utf8')) as {
      capabilities: string[]; sandbox: { rpc_allowlist: string[] }; source_spec: { source_slug: string };
    };
    expect(rozvrhy.map(([, c]) => c).sort()).toEqual([...manifest.capabilities].sort());
    expect(manifest.sandbox.rpc_allowlist).toEqual(['audience_sync_source_catalog', 'avp_project_fuelings', 'avp_propose_identity']);
    expect(manifest.source_spec.source_slug, 'plugin zapisuje pod jménem, které broker vynucuje').toBe('avp-portal');
  });
});

describe('mappers', () => {
  it('výdej bez id nebo času se zahodí, nevymýšlí se', () => {
    expect(mapFueling({ id: 0, time: '2026-09-25T10:00:00Z' })).toBeNull();
    expect(mapFueling({ id: 5, time: 'není čas' })).toBeNull();
    expect(mapFueling({ id: 5, time: '2026-09-25T10:00:00Z', liters: Number.NaN })?.fields.liters).toBeNull();
  });

  it('nejpozdeji: vezme maximum, prázdné a neplatné časy přeskočí', () => {
    expect(nejpozdeji(['2026-09-25T10:00:00Z', null, 'x', '2026-09-25T11:00:00Z'], '2026-09-01T00:00:00Z')).toBe('2026-09-25T11:00:00Z');
    expect(nejpozdeji([], '2026-09-01T00:00:00Z')).toBe('2026-09-01T00:00:00Z');
  });
});
