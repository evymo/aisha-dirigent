/**
 * Test celé sync dráhy pluginu se stubovaným sandbox `ctx` — bez sítě.
 *
 * 0.2.0 (2026-09-27): plugin zapisuje na OBECNOU SUROVOU DRÁHU
 * (`audience_sync_source_catalog`, zdroj `eurowag-telematics`), nezakládá
 * dvojčata a NEUKLÁDÁ POLOHY. Ověřuje se:
 *   · co se zapíše, jakým druhem a režimem (číselník snapshot, jízdy/stavy series),
 *   · že souřadnice, rychlost ani místa jízdy nikde nejsou,
 *   · korekce dodavatele (metry → km, sentinel −1, nesmyslné l/100 km → null),
 *   · po zápisu návrhy / projekce — a jejich selhání NEMLČÍ (uložené zůstane),
 *   · kurzor jízd: posun jen po celém okně, okno s překryvem 48 h,
 *   · poll stavů: výchozí hodinový, 0 = vypnuto (ne každou minutu),
 *   · 0.2.1: stránkování jako ostré API (limit ≤ 29, offset), řidič jízdy z `id`
 *     (hlavní podle `isMain`), časy jízd jako UTC.
 * Data jsou smyšlená.
 */
import { describe, expect, it, vi } from 'vitest';
import { handle, init, stateCron } from '../index.ts';

const STATES = [
  {
    monitoredObjectId: 900001,
    rn: '1ZZ  0001', // dvojité mezery — jako v ostrém API
    odometer: 11_028_000, // metry → 11 028 km
    gpsData: { time: '2026-09-03T15:56:25+00:00', lat: 50.1, lon: 17.1, speed: 55 },
    stateData: { time: '2026-09-03T15:56:25+00:00', ignition: 0 },
    fuelTanks: [{ id: 0, level: null }],
    driver: { id: '7', name: 'Testovací Řidič', source: 'tachograph' }, // tvar VehicleDriver
  },
  {
    monitoredObjectId: 900002,
    rn: '2ZZ 0002',
    odometer: 342_056_000,
    gpsData: { time: '2026-09-03T15:56:16+00:00', lat: 49.1, lon: 18.1, speed: 0 },
    stateData: { time: '2026-09-03T15:56:16+00:00', ignition: 1 },
    fuelTanks: [{ id: 0, level: 370 }],
  },
];

const DRIVERS = [{ id: 7, client_id: 'c1', name: 'Testovací', surname: 'Řidič' }];

const TRIP_900001 = [
  {
    id: 'trip-1',
    monitoredObjectId: '900001',
    startTime: '2026-09-03T13:28:51',
    endTime: '2026-09-03T14:26:23',
    distance: 42_000, // metry → 42 km
    duration: 3452,
    totalConsumption: 12.5,
    consumption_liters_100km: 29.8,
    // tvar TripDriver ze stažených jízd: klíč `id`, ne `driver_id`
    drivers: [{ id: 5, isMain: false, name: 'Spolujezdec', surname: 'Test', sso_id: null }, { id: 7, isMain: true, name: 'Testovací', surname: 'Řidič', sso_id: null }],
    placeStart: { name: 'Výchozí obec', lat: 49.9, lon: 16.9 },
    placeEnd: { name: 'Cílová obec', lat: 50.2, lon: 17.2 },
  },
];
const TRIP_900002 = [
  { id: 'trip-2', monitoredObjectId: '900002', startTime: '2026-09-03T09:00:00', endTime: '2026-09-03T10:00:00', distance: 30_000, duration: 3600, totalConsumption: -1, consumption_liters_100km: 281, drivers: [] },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stránka jako ostré API: výchozí limit 12, limit ≥ 30 → 422 (naměřeno 28. 9.). */
function strana<T>(vse: T[], url: string): { data: T[] } | Response {
  const q = new URL(url).searchParams;
  const limit = Number(q.get('limit') ?? 12);
  const offset = Number(q.get('offset') ?? 0);
  if (limit >= 30) return json({ detail: [{ msg: 'ensure this value is less than 30' }] }, 422);
  return { data: vse.slice(offset, offset + limit) };
}

type Volani = { fn: string; args: Record<string, unknown> };
type Radek = { externalId: string; occurredAt: string | null; fields: Record<string, unknown> };

function makeCtx(
  opts: {
    failTripsFor?: number;
    drivers?: unknown[];
    /** `configuration.filter`; výchozí = přesně vozidla ze STATES. null = dodavatel filtr neposlal. */
    filter?: string[] | null;
    trips?: Record<number, unknown[]>;
    rpcFail?: string;
    rpcReturns?: Record<string, unknown>;
    kv?: Record<string, unknown>;
    config?: Record<string, unknown>;
  } = {},
) {
  const kv = new Map<string, unknown>(Object.entries(opts.kv ?? {}));
  const rpcCalls: Volani[] = [];
  const urls: string[] = [];
  const ctx = {
    plugin: { version: '0.2.2' },
    tenant: { id: 't1' },
    config: {
      baseUrl: 'https://telematics.example.test/customer-api/v1',
      tokenUrl: 'https://login.example.test/token',
      clientId: 'cid',
      apiKey: 'k',
      username: 'u',
      password: 'p',
      tripBackfillDays: 30,
      tripPauseMs: 0, // v testu žádné čekání
      maxPlausibleConsumptionPer100km: 100,
      ...(opts.config ?? {}),
    },
    log: vi.fn(),
    schedule: vi.fn(),
    kv: { get: async (k: string) => kv.get(k) ?? null, set: async (k: string, v: unknown) => void kv.set(k, v) },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args: args ?? {} });
      if (fn === opts.rpcFail) throw new Error(`${fn} exploded`);
      if (opts.rpcReturns && fn in opts.rpcReturns) return opts.rpcReturns[fn];
      return { ok: true };
    },
    fetch: async (url: string): Promise<Response> => {
      urls.push(url);
      if (url.includes('/token')) return json({ access_token: 't', expires_in: 300 });
      if (url.includes('/vehicles-states')) return json(STATES);
      if (url.includes('/configuration')) {
        const filter = opts.filter === undefined ? ['900001', '900002'] : opts.filter;
        // ostré API vrací v těle i api_key — plugin ho nesmí nikam propsat
        return json({ id: 1, name: 'test', api_key: 'TAJNY-KLIC', filter, client_id: '1' });
      }
      if (url.includes('/drivers')) {
        const vse = opts.drivers ?? DRIVERS;
        const s = strana(vse, url);
        return s instanceof Response ? s : json({ ...s, limit: s.data.length, offset: 0, total: vse.length });
      }
      if (url.includes('/trips')) {
        const mo = Number(new URL(url).searchParams.get('monitored_object_id'));
        if (opts.failTripsFor != null && mo === opts.failTripsFor) return new Response('boom', { status: 500 });
        const s = strana(opts.trips?.[mo] ?? (mo === 900001 ? TRIP_900001 : TRIP_900002), url);
        return s instanceof Response ? s : json(s.data); // jízdy = holé pole bez total
      }
      return new Response('not found', { status: 404 });
    },
  };
  return { ctx, kv, rpcCalls, urls };
}

const zapisy = (rpcCalls: Volani[], kind: string) =>
  rpcCalls
    .filter((c) => c.fn === 'audience_sync_source_catalog' && c.args.p_kind === kind)
    .flatMap((c) => c.args.p_rows as Radek[]);

const POLOHA = /lat|lon|speed|place|Výchozí|Cílová/;

describe('cron.sync_fleet', () => {
  it('vozidla (SPZ) a řidiči jako snapshot pod eurowag-telematics, pak NÁVRHY vazeb; žádné dvojče', async () => {
    const { ctx, rpcCalls } = makeCtx();
    const res = (await handle(ctx as never, 'cron.sync_fleet')) as { vehicles: number; drivers: number };
    expect(res).toMatchObject({ vehicles: 2, drivers: 1 });
    expect(rpcCalls.map((c) => [c.fn, c.args.p_source_slug, c.args.p_kind, c.args.p_mode])).toEqual([
      ['audience_sync_source_catalog', 'eurowag-telematics', 'vehicle', 'snapshot'],
      ['audience_sync_source_catalog', 'eurowag-telematics', 'driver', 'snapshot'],
      ['ew_propose_identity', undefined, undefined, undefined],
    ]);
    expect(zapisy(rpcCalls, 'vehicle')).toContainEqual({ externalId: '900001', occurredAt: null, fields: { rn: '1ZZ 0001' } });
    expect(rpcCalls.some((c) => c.fn.startsWith('twin_'))).toBe(false);
  });

  it('selhání návrhů NEmlčí — číselník uložený, běh skončí chybou', async () => {
    const { ctx, rpcCalls } = makeCtx({ rpcFail: 'ew_propose_identity' });
    await expect(handle(ctx as never, 'cron.sync_fleet')).rejects.toThrow(/číselník uložen, ale návrhy vazeb identity selhaly/);
    expect(zapisy(rpcCalls, 'vehicle')).toHaveLength(2);
  });
});

describe('cron.poll_vehicle_states', () => {
  it('stav bez polohy: tachometr v km, hladina, zapalování; pak projekce', async () => {
    const { ctx, kv, rpcCalls } = makeCtx();
    const res = (await handle(ctx as never, 'cron.poll_vehicle_states')) as { recorded: number };
    const stavy = zapisy(rpcCalls, 'vehicle_state');
    expect(stavy.map((r) => r.externalId).sort()).toEqual(['900001:2026-09-03T15:56:25+00:00', '900002:2026-09-03T15:56:16+00:00']);
    expect(stavy.find((r) => r.externalId.startsWith('900001'))?.fields).toEqual({
      monitored_object_id: 900001, odometer_km: 11_028, fuel_level_l: null, ignition: false,
    });
    expect(JSON.stringify(stavy)).not.toMatch(POLOHA);
    expect(res.recorded).toBe(2);
    expect(kv.get('eurowag:last-state-poll')).toBeTruthy();
    expect(rpcCalls.at(-1)).toEqual({ fn: 'ew_project_catalog', args: { p_okno_min: 180 } });
  });

  it('chyba projekce vrácená jako OBJEKT nemlčí — stavy zůstanou uložené', async () => {
    const { ctx, rpcCalls } = makeCtx({ rpcReturns: { ew_project_catalog: { error: { code: '42501' } } } });
    await expect(handle(ctx as never, 'cron.poll_vehicle_states')).rejects.toThrow(
      /stavy uloženy, ale projekce na dvojčata selhala: \{"code":"42501"\}/,
    );
    expect(zapisy(rpcCalls, 'vehicle_state')).toHaveLength(2);
  });
});

describe('cron.sync_trips', () => {
  it('jízdy bez míst, km z metrů, sentinel a nesmysl → null; kurzor posunut; projekce', async () => {
    const { ctx, kv, rpcCalls } = makeCtx();
    const res = (await handle(ctx as never, 'cron.sync_trips')) as { trips: number; failed: number };
    const jizdy = zapisy(rpcCalls, 'trip');
    expect(jizdy.map((r) => r.externalId).sort()).toEqual(['trip-1', 'trip-2']);
    const t1 = jizdy.find((r) => r.externalId === 'trip-1')!;
    expect(t1.occurredAt, 'API posílá UTC bez zóny — uložit s ní').toBe('2026-09-03T13:28:51Z');
    expect(t1.fields).toMatchObject({
      monitored_object_id: 900001, end_time: '2026-09-03T14:26:23Z', distance_km: 42, consumption_l: 12.5,
      driver_id: 7, // hlavní řidič (isMain), ne první v poli
    });
    const t2 = jizdy.find((r) => r.externalId === 'trip-2')!;
    expect(t2.fields).toMatchObject({ consumption_l: null, consumption_l_100km: null, driver_id: null });
    expect(JSON.stringify(jizdy)).not.toMatch(POLOHA);
    expect(res).toMatchObject({ trips: 2, failed: 0 });
    expect(kv.get('eurowag:last-trip-sync')).toBeTruthy();
    expect(rpcCalls.at(-1)?.fn).toBe('ew_project_catalog');
  });

  it('při selhání jednoho vozidla kurzor NEposune a pokračuje dál', async () => {
    const { ctx, kv, rpcCalls } = makeCtx({ failTripsFor: 900002 });
    const res = (await handle(ctx as never, 'cron.sync_trips')) as { failed: number };
    expect(zapisy(rpcCalls, 'trip').map((r) => r.externalId)).toEqual(['trip-1']);
    expect(res.failed).toBe(1);
    expect(kv.get('eurowag:last-trip-sync')).toBeUndefined();
  });

  it('okno jízd začíná 48 h PŘED kurzorem (dodavatel dopočítává zpětně)', async () => {
    const { ctx, urls } = makeCtx({ kv: { 'eurowag:last-trip-sync': '2026-09-26T03:40:00.000Z' } });
    await handle(ctx as never, 'cron.sync_trips');
    const od = urls.filter((u) => u.includes('/trips')).map((u) => new URL(u).searchParams.get('date_from'));
    expect(od).toEqual(['2026-09-24T03:40:00.000Z', '2026-09-24T03:40:00.000Z']);
  });

  it('neznámá capability → chyba', async () => {
    const { ctx } = makeCtx();
    await expect(handle(ctx as never, 'cron.blabla')).rejects.toThrow(/neznámá capability/);
  });
});

describe('0.2.1 — stránkování (limit ≤ 29) a strop volání', () => {
  const ridici = Array.from({ length: 59 }, (_, i) => ({ id: i + 1, client_id: 'c1', name: `J${i + 1}`, surname: 'Test' }));
  const jizdy = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `t-${i}`, monitoredObjectId: '900001', startTime: `2026-09-0${1 + (i % 9)}T0${i % 10}:00:00`,
      distance: 1000, duration: 60, totalConsumption: 1, drivers: [],
    }));

  it('číselník řidičů = VŠECH 59 (3 stránky), ne prvních 12 — snapshot z jedné stránky by vyřadil zbytek', async () => {
    const { ctx, rpcCalls, urls } = makeCtx({ drivers: ridici });
    const res = (await handle(ctx as never, 'cron.sync_fleet')) as { drivers: number };
    expect(res.drivers).toBe(59);
    expect(zapisy(rpcCalls, 'driver').map((r) => r.externalId)).toHaveLength(59);
    const stranky = urls.filter((u) => u.includes('/drivers')).map((u) => new URL(u).searchParams);
    expect(stranky.map((q) => [q.get('limit'), q.get('offset')])).toEqual([['29', '0'], ['29', '29'], ['29', '58']]);
  });

  it('jízdy vozidla přes více stránek se uloží všechny; strop počítá STRÁNKY', async () => {
    const { ctx, rpcCalls, urls, kv } = makeCtx({ trips: { 900001: jizdy(60), 900002: [] } });
    const res = (await handle(ctx as never, 'cron.sync_trips')) as { trips: number; failed: number };
    expect(res).toMatchObject({ trips: 60, failed: 0 });
    expect(zapisy(rpcCalls, 'trip')).toHaveLength(60);
    // 60 jízd = stránky 29 + 29 + 2; druhé vozidlo jedna prázdná stránka
    expect(urls.filter((u) => u.includes('/trips'))).toHaveLength(4);
    expect(kv.get('eurowag:last-trip-sync')).toBeTruthy();

    const s = makeCtx({ trips: { 900001: jizdy(60), 900002: jizdy(1) }, config: { tripCallBudget: 3 } });
    await handle(s.ctx as never, 'cron.sync_trips');
    expect(s.urls.filter((u) => u.includes('/trips')), 'po 3 stránkách prvního vozidla se druhé už nečte').toHaveLength(3);
    expect(s.kv.get('eurowag:last-trip-sync'), 'vyčerpaný strop drží kurzor').toBeUndefined();
  });
});

describe('0.2.2 — soupis vozidel proti filtru API klíče', () => {
  it('shoda filtru a vrácených vozidel: běh projde a počet objektů filtru je v logu', async () => {
    const { ctx, rpcCalls } = makeCtx();
    await handle(ctx as never, 'cron.sync_fleet');
    const zapsan = (ctx.log as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === 'eurowag: číselník zapsán');
    expect(zapsan?.[2]).toMatchObject({ vehicles: 2, filterObjects: 2 });
    expect(JSON.stringify([(ctx.log as ReturnType<typeof vi.fn>).mock.calls, rpcCalls])).not.toContain('TAJNY-KLIC');
  });

  it('filtr pouští víc, než API vrátilo → číselník uložen, běh skončí chybou s oběma počty a radou', async () => {
    const { ctx, rpcCalls } = makeCtx({ filter: ['900001', '900002', '900003'] });
    await expect(handle(ctx as never, 'cron.sync_fleet')).rejects.toThrow(
      /filtr 3 objektů, \/vehicles-states vrátil 2 \(ve filtru a nevráceno: 1, vráceno mimo filtr: 0\).*dodavatel \(Eurowag\)/,
    );
    expect(zapisy(rpcCalls, 'vehicle')).toHaveLength(2);
    expect(rpcCalls.some((c) => c.fn === 'ew_propose_identity'), 'návrhy vazeb proběhnou i při nesouladu').toBe(true);
  });

  it('vozidlo vrácené mimo filtr je taky nesoulad; chybějící filtr se neporovnává', async () => {
    await expect(handle(makeCtx({ filter: ['900001'] }).ctx as never, 'cron.sync_fleet')).rejects.toThrow(/vráceno mimo filtr: 1/);
    await expect(handle(makeCtx({ filter: null }).ctx as never, 'cron.sync_fleet')).resolves.toMatchObject({ vehicles: 2 });
  });
});

describe('rozvrh a náhled', () => {
  it('poll stavů: výchozí hodinový, 0 = vypnuto (ne každou minutu)', async () => {
    expect(stateCron(3600)).toBe('7 * * * *');
    expect(stateCron(300)).toBe('*/5 * * * *');
    expect(stateCron(7200)).toBe('7 */2 * * *');
    expect(stateCron(0)).toBeNull();
    const { ctx } = makeCtx({ config: { vehicleStatePollSeconds: 0 } });
    await init(ctx as never);
    const caps = (ctx.schedule as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(caps).not.toContain('cron.poll_vehicle_states');
  });

  it('náhled stavů pro ověření přístupu nevrací souřadnice ani rychlost', async () => {
    const { ctx } = makeCtx();
    const res = (await handle(ctx as never, 'http.GET./vehicles-states')) as { rows: unknown[] };
    expect(JSON.stringify(res.rows)).not.toMatch(/"lat"|"lon"|"speed"/);
  });
});
