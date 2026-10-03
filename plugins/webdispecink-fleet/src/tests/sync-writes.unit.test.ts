/**
 * Webdispečink zapisuje do registru — a jízdy přežijí jedno vadné vozidlo.
 *
 * PROČ TENHLE SOUBOR EXISTUJE
 * ---------------------------
 * Plugin dodavatele četl a data ZAHAZOVAL. `syncFleet` i `pollPositions`
 * skončily `ctx.kv.set(...)` a `ctx.log('info', …, { count })` — žádné
 * `ctx.rpc`. Databáze přitom měla celou druhou půlku potrubí: tabulky `wd_*`,
 * RLS, indexy a všechny čtyři funkce `wd_upsert_*_audited`. Zapisovatel se
 * ztratil při přesunu ze zrušené služby `svc-webdispecink` do pluginu
 * (`df25a389` — „fleet vendors become plugins, not services"): mappery se
 * nepřenesly a bez nich nebylo co RPC předat.
 *
 * Selhání bylo TICHÉ a vypadalo jako úspěch: log hlásil „positions polled,
 * count: 14", takže konektor vypadal zdravě, zatímco registr zůstával prázdný.
 * Proto první dva testy netvrdí nic o tvaru dat — tvrdí, že se RPC VŮBEC
 * ZAVOLALO. Log s počtem přečtených řádků není důkaz uložení.
 *
 * Zbytek pinuje záruky knihy jízd, které si tcars konektor vynutil skutečnou
 * vadou (jedno nečitelné vozidlo shodilo celý sběr a kurzor se nikdy nepohnul).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import { handle } from '../index.js';

/** Odpověď v tom tvaru, který parseSoapResponse skutečně čte. */
function soap(operation: string, items: Array<Record<string, string | number>>): string {
  const body = items
    .map(
      (row) =>
        `<item>${Object.entries(row)
          .map(([k, v]) => `<${k}>${v}</${k}>`)
          .join('')}</item>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<SOAP-ENV:Body><ns1:${operation}Response>` +
    `<return>${body}</return>` +
    `</ns1:${operation}Response></SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

// Jména polí jsou DODAVATELOVA a nejsou konzistentní: vozidla a polohy malými
// (carid, positiontime), kniha jízd velkými (Id_jizda, Idcar). Fixtura to musí
// respektovat, jinak by testovala slovník, který API nikdy nepošle.
const CARS = soap('_getCarsList2', [
  { carid: 11, identifikator: '1A1 1111', popis: 'Tatra', disabled: 0, odometerKm: 120_000 },
  { carid: 22, identifikator: '2B2 2222', popis: 'Scania', disabled: 0, odometerKm: 90_000 },
]);
const DRIVERS = soap('_getDriversList2', [
  { iddriver: 7, jmeno: 'Jan', prijmeni: 'Novák', osobnicislo: 'A-7', disabled: 0 },
]);
const POSITIONS = soap('_getAllCarsPosition', [
  { carid: 11, positiontime: '2026-08-04 10:00:00', latitude: '50.1', longitude: '14.4', speed: '61' },
]);
const RIDES = soap('_getCarLogBook4', [
  {
    Id_jizda: 901,
    Idcar: 11,
    Dt_from: '2026-08-01 08:00:00',
    Dt_to: '2026-08-01 09:30:00',
    Vzdalenost: '42,5',
    Doba_jizdy: '01:30',
  },
]);
// Výkony řidičů podle tachografu — TotalDrive už v SEKUNDÁCH, DateW 'DD.MM.YYYY'.
const WORKTIME = soap('_getDriverWorkTacho', [
  {
    IdDriver: 7, CarIdentifikator: '1A1 1111', DateW: '18.08.2026', Day: 'Tue', DayType: 'P',
    WorkFrom: '05:38', WorkTo: '16:50', TotalDrive: 26_580, TotalWork: 3600, TotalRest: 56_220,
    TotalStandBy: 0, NightDrive: 120, NightRest: 27_600, NightWork: 1080, NightStandBy: 0,
    Dist: '440,49', Absence1: 0, Absence2: 0, Absence3: 0, Absence4: 0, Absence5: 0, Absence6: 0, Absence7: 0,
  },
]);
// Překročení rychlosti — El=DÉLKA (17.x), Ew=ŠÍŘKA (50.x); čas 'DD.MM.YYYY HH:MM:SS'.
const OVERSPEED = soap('_getCarOverSpeed', [
  { IdCar: 11, IdDriver: 7, MSpeed: 96, Time_from: '18.08.2026 06:32:20', Time_to: '18.08.2026 07:53:38',
    El: '17.124853', Ew: '50.310576', Dist: '64.569' },
]);
// Statistika řidičů (fleet-wide) — km + doby den/noc; doby 'HH:MM:SS' i přes 24 h.
const STADRIVERS = soap('_getStaDrivers', [
  { iddriver: 7, Jmeno: 'Jan', Prijmeni: 'Novák', Celkem_km: '1429,39', Sluzebni_km: '1429,39', Soukrome_km: '0',
    Doba_jizdy: '25:34:38', Doba_jizdy_sluzebni: '25:34:38', Doba_jizdy_soukroma: '00:00:00',
    Doba_jizdy_sluzebni_den: '23:45:34', Doba_jizdy_sluzebni_noc: '01:49:04', DomovPraceDomov: '0' },
]);

interface Calls {
  rpc: Array<{ fn: string; args?: Record<string, unknown> }>;
  kv: Record<string, unknown>;
  warns: string[];
}

/**
 * Ctx double. `failFor` jmenuje vozidla, jejichž kniha jízd skončí chybou;
 * `registry` je to, co o aktivních vozidlech ví DB (pracovní seznam jízd).
 */
function makeCtx(
  opts: {
    failFor?: number[];
    registry?: number[];
    config?: Record<string, unknown>;
    /** RPC, které vyhodí výjimku. */
    rpcFail?: string;
    /** RPC → co vrátí (např. chybu jako objekt místo výjimky). */
    rpcReturns?: Record<string, unknown>;
    kv?: Record<string, unknown>;
  } = {},
) {
  const { failFor = [], registry = [11, 22], config = {}, rpcFail, rpcReturns = {} } = opts;
  const calls: Calls = { rpc: [], kv: { ...(opts.kv ?? {}) }, warns: [] };
  const bodies: string[] = [];

  const ctx = {
    plugin: { version: 'test' },
    tenant: { id: 'test-tenant' },
    config: { kodf: 'k', username: 'u', password: 'p', ridePauseMs: 0, ...config },
    log(level: string, msg: string) {
      if (level === 'warn' || level === 'error') calls.warns.push(msg);
    },
    async fetch(_url: string, init?: RequestInit) {
      const body = String(init?.body ?? '');
      bodies.push(body);
      if (body.includes('_getCarsList2')) return new Response(CARS, { status: 200 });
      if (body.includes('_getDriversList2')) return new Response(DRIVERS, { status: 200 });
      if (body.includes('_getAllCarsPosition')) return new Response(POSITIONS, { status: 200 });
      if (body.includes('_getCarLogBook4')) {
        const id = Number(body.match(/<carid[^>]*>(\d+)<\/carid>/i)?.[1] ?? 0);
        if (failFor.includes(id)) return new Response('boom', { status: 500 });
        return new Response(RIDES, { status: 200 });
      }
      if (body.includes('_getDriverWorkTacho')) {
        const id = Number(body.match(/<IdDriver[^>]*>(\d+)<\/IdDriver>/i)?.[1] ?? 0);
        if (failFor.includes(id)) return new Response('boom', { status: 500 });
        return new Response(WORKTIME, { status: 200 });
      }
      if (body.includes('_getCarOverSpeed')) {
        const id = Number(body.match(/<IdCar[^>]*>(\d+)<\/IdCar>/i)?.[1] ?? 0);
        if (failFor.includes(id)) return new Response('boom', { status: 500 });
        return new Response(OVERSPEED, { status: 200 });
      }
      if (body.includes('_getStaDrivers')) return new Response(STADRIVERS, { status: 200 });
      return new Response('', { status: 200 });
    },
    kv: {
      async get(k: string) {
        return calls.kv[k];
      },
      async set(k: string, v: unknown) {
        calls.kv[k] = v;
      },
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      if (fn === rpcFail) throw new Error(`${fn} exploded`);
      if (fn in rpcReturns) return rpcReturns[fn];
      if (fn === 'wd_list_sync_vehicle_ids') return registry.map((wd_car_id) => ({ wd_car_id }));
      return { ok: true };
    },
    schedule() {},
  };
  return { ctx, calls, bodies };
}

const rpcNames = (calls: Calls) => calls.rpc.map((c) => c.fn);

describe('webdispecink zapisuje, ne jen čte', () => {
  it('sync flotily uloží vozidla i řidiče přes wd_upsert_*', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.sync_fleet');

    // Jádro regrese: dřív tady nebylo ANI JEDNO rpc volání a log přesto hlásil
    // „fleet synced". Počet přečtených řádků není důkaz uložení.
    expect(rpcNames(calls)).toContain('wd_upsert_vehicles_audited');
    expect(rpcNames(calls)).toContain('wd_upsert_drivers_audited');

    const vehicles = calls.rpc.find((c) => c.fn === 'wd_upsert_vehicles_audited')
      ?.args?.p_vehicles as Array<Record<string, unknown>>;
    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]).toMatchObject({ wd_car_id: 11, identifier: '1A1 1111', active: true });
    // Surová položka jede s sebou, takže změna API neznamená ztrátu polí.
    expect(vehicles[0].raw).toBeTruthy();
  });

  it('poll poloh uloží polohy přes wd_upsert_positions_audited', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.poll_positions');

    expect(rpcNames(calls)).toContain('wd_upsert_positions_audited');
    const positions = calls.rpc.find((c) => c.fn === 'wd_upsert_positions_audited')
      ?.args?.p_positions as Array<Record<string, unknown>>;
    expect(positions[0]).toMatchObject({ wd_car_id: 11, speed_kmh: 61, moving: true });
  });
});

describe('kniha jízd přežije vadné vozidlo', () => {
  it('pracovní seznam je REGISTR — prázdný registr je hlášená mezera, ne tichý úspěch', async () => {
    const { ctx, calls } = makeCtx({ registry: [] });
    const result = (await handle(ctx as never, 'cron.sync_rides')) as { vehicles: number };

    expect(result.vehicles).toBe(0);
    expect(rpcNames(calls)).not.toContain('wd_upsert_rides_audited');
    expect(calls.warns.join(' ')).toMatch(/nezná žádné aktivní vozidlo/);
  });

  it('jedno selhavší vozidlo nezastaví ostatní', async () => {
    const { ctx, calls } = makeCtx({ failFor: [11] });
    const result = (await handle(ctx as never, 'cron.sync_rides')) as {
      vehicles: number;
      rides: number;
      failed: number;
    };

    expect(result.failed).toBe(1);
    // Vozidlo 22 se ULOŽILO, přestože 11 spadlo.
    expect(result.rides).toBeGreaterThan(0);
    expect(rpcNames(calls)).toContain('wd_upsert_rides_audited');
  });

  it('kurzor se po selhání NEPOSUNE — okno se přečte znovu místo ztráty dat', async () => {
    const { ctx, calls } = makeCtx({ failFor: [11] });
    await handle(ctx as never, 'cron.sync_rides');

    expect(calls.kv['webdispecink:last-ride-sync']).toBeUndefined();
    expect(calls.warns.join(' ')).toMatch(/cursor held back/);
  });

  it('kurzor se posune, když se celé okno uložilo — a v dodavatelově formátu', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.sync_rides');

    const cursor = calls.kv['webdispecink:last-ride-sync'];
    // 'YYYY-MM-DD HH:mm:ss', ne ISO — dodavatel jiný tvar okna nepřijme.
    expect(cursor).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('strop na počet volání zastaví běh a kurzor drží zpátky', async () => {
    const { ctx, calls } = makeCtx({ config: { rideCallBudget: 1 } });
    const result = (await handle(ctx as never, 'cron.sync_rides')) as { rides: number };

    expect(result.rides).toBeGreaterThan(0); // první vozidlo prošlo
    expect(calls.kv['webdispecink:last-ride-sync']).toBeUndefined();
    expect(calls.warns.join(' ')).toMatch(/budget exhausted/);
  });

  it('sync worktime uloží tacho výkony přes wd_upsert_worktime_audited', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.sync_worktime');

    expect(rpcNames(calls)).toContain('wd_upsert_worktime_audited');
    const wt = calls.rpc.find((c) => c.fn === 'wd_upsert_worktime_audited')
      ?.args?.p_worktime as Array<Record<string, unknown>>;
    expect(wt).toHaveLength(1);
    // DateW 'DD.MM.YYYY' → ISO; TotalDrive/Work jsou UŽ v sekundách; Dist '440,49' → 440.49.
    expect(wt[0]).toMatchObject({
      wd_driver_id: 7,
      car_identifikator: '1A1 1111',
      work_date: '2026-08-18',
      total_drive_seconds: 26_580,
      total_work_seconds: 3600,
      distance_km: 440.49,
    });
    expect(calls.kv['webdispecink:last-worktime-sync']).toBeTruthy(); // kurzor posunut
  });

  it('worktime: selhání jednoho řidiče kurzor NEposune', async () => {
    const { ctx, calls } = makeCtx({ failFor: [7] }); // /worktime řidiče 7 vrátí 500
    const result = (await handle(ctx as never, 'cron.sync_worktime')) as { failed: number };

    expect(result.failed).toBe(1);
    expect(calls.kv['webdispecink:last-worktime-sync']).toBeUndefined();
  });

  it('sync overspeed uloží úseky přes wd_upsert_overspeed_audited (s polohou)', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.sync_overspeed');

    expect(rpcNames(calls)).toContain('wd_upsert_overspeed_audited');
    const ev = calls.rpc.find((c) => c.fn === 'wd_upsert_overspeed_audited')
      ?.args?.p_events as Array<Record<string, unknown>>;
    expect(ev.length).toBeGreaterThan(0);
    // El→lon, Ew→lat (v odpovědi prohozené); čas 'DD.MM.YYYY HH:MM:SS'→ISO.
    expect(ev[0]).toMatchObject({
      wd_car_id: 11, max_speed_kmh: 96, time_from: '2026-08-18T06:32:20',
      lat: 50.310576, lon: 17.124853,
    });
  });

  it('sync driver stats uloží snapshot přes wd_upsert_driver_stats_audited', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.sync_driver_stats');

    expect(rpcNames(calls)).toContain('wd_upsert_driver_stats_audited');
    const st = calls.rpc.find((c) => c.fn === 'wd_upsert_driver_stats_audited')
      ?.args?.p_stats as Array<Record<string, unknown>>;
    expect(st).toHaveLength(1);
    // '1429,39'→1429.39; noční '01:49:04'→6544 s; period doplní sync.
    expect(st[0]).toMatchObject({
      wd_driver_id: 7, service_km: 1429.39,
      driving_service_night_seconds: 1 * 3600 + 49 * 60 + 4,
    });
    expect(st[0].period_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dvojčata: návrhy a projekce po synchronizaci — a selhání nemlčí', () => {
  it('po číselníku NÁVRHY vazeb, až nad uloženým registrem', async () => {
    const { ctx, calls } = makeCtx();
    const result = (await handle(ctx as never, 'cron.sync_fleet')) as { carsStored: number };
    expect(result.carsStored).toBe(2);
    expect(rpcNames(calls)).toEqual(['wd_upsert_vehicles_audited', 'wd_upsert_drivers_audited', 'wd_propose_identity']);
  });

  it('selhání zápisu číselníku NEPOLYKÁ — běh skončí chybou (dřív tichý catch)', async () => {
    const { ctx } = makeCtx({ rpcFail: 'wd_upsert_vehicles_audited' });
    await expect(handle(ctx as never, 'cron.sync_fleet')).rejects.toThrow(/wd_upsert_vehicles_audited exploded/);
  });

  it('po jízdách i výkonech PROJEKCE na dvojčata (po zápisu, s oknem)', async () => {
    const { ctx, calls } = makeCtx();
    await handle(ctx as never, 'cron.sync_rides');
    await handle(ctx as never, 'cron.sync_worktime');
    const projekce = calls.rpc.filter((c) => c.fn.startsWith('wd_project_'));
    expect(projekce).toEqual([
      { fn: 'wd_project_rides', args: { p_okno_min: 180 } },
      { fn: 'wd_project_worktime', args: { p_okno_min: 180 } },
    ]);
  });

  it('chyba projekce vrácená jako OBJEKT nemlčí — jízdy i kurzor zůstanou uložené', async () => {
    const { ctx, calls } = makeCtx({ rpcReturns: { wd_project_rides: { error: { code: '42501' } } } });
    await expect(handle(ctx as never, 'cron.sync_rides')).rejects.toThrow(
      /jízdy uloženy, ale projekce na dvojčata selhala: \{"code":"42501"\}/,
    );
    expect(rpcNames(calls).filter((f) => f === 'wd_upsert_rides_audited').length).toBe(2);
    expect(calls.kv['webdispecink:last-ride-sync']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('okno jízd začíná 48 h PŘED kurzorem (zpětné opravy dodavatele), v jeho formátu a UTC', async () => {
    const { ctx, bodies } = makeCtx({ kv: { 'webdispecink:last-ride-sync': '2026-09-26 03:40:00' } });
    await handle(ctx as never, 'cron.sync_rides');
    const od = bodies.filter((b) => b.includes('_getCarLogBook4')).map((b) => /<casod[^>]*>([^<]+)</.exec(b)?.[1]);
    expect(od).toEqual(['2026-09-24 03:40:00', '2026-09-24 03:40:00']);
  });
});
