/**
 * Ride sync resilience — the connector must survive ONE unreadable vehicle.
 *
 * The journey log is fetched per vehicle, so the fleet is the work list. The
 * first version had a bare `for` loop: the first vendor error aborted the whole
 * run, every remaining vehicle was skipped, and the cursor (set after the loop)
 * never moved — one bad row stalled the connector until someone looked.
 *
 * These tests pin the two guarantees that fix has to keep:
 *   1. a failing vehicle is isolated — the others still land;
 *   2. the cursor only advances when the whole window was actually stored,
 *      because advancing past a vehicle that returned nothing would skip its
 *      rides for good.
 *
 * @module
 */
import { describe, it, expect, vi } from 'vitest';
import { handle } from '../index.js';

/** Minimal SOAP envelope carrying an arrayType payload, as the vendor sends it. */
function soap(operation: string, inner: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<SOAP-ENV:Body><ns1:${operation}Response xmlns:ns1="http://webservice.t-cars.cz/soap/TCarsWebService">` +
    inner +
    `</ns1:${operation}Response></SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

// Element names follow what tc-client actually reads (extractList wrapper/item
// = vozidla/vozidlo, book.jizdy.jizda) — NOT the docx spelling (aVozidla),
// which the parser never sees because the client unwraps by these names.
const VEHICLE_LIST = soap(
  'vozidlaSeznam',
  `<vozidla>` +
    `<vozidlo><vozidloId>11</vozidloId><vozidloRz>1A1 1111</vozidloRz><vozidloVyrazeno>false</vozidloVyrazeno></vozidlo>` +
    `<vozidlo><vozidloId>22</vozidloId><vozidloRz>2B2 2222</vozidloRz><vozidloVyrazeno>false</vozidloVyrazeno></vozidlo>` +
    `</vozidla>`,
);

const RIDE_BOOK = soap(
  'knihaJizdVozidlo',
  `<jizdy><jizda><jizdaId>901</jizdaId><jizdaOd>2026-07-01 08:00:00</jizdaOd>` +
    `<jizdaDo>2026-07-01 09:00:00</jizdaDo><jizdaDelka>42</jizdaDelka></jizda></jizdy>`,
);

interface Calls {
  rpc: Array<{ fn: string; args?: Record<string, unknown> }>;
  kv: Record<string, unknown>;
  warns: string[];
}

/**
 * Ctx double: `failFor` names the vehicle ids whose journey log errors out,
 * `rpcFail` the RPC that throws, `kv` the state a previous run left behind.
 */
function makeCtx(
  failFor: number[] = [],
  config: Record<string, unknown> = {},
  opts: { rpcFail?: string; kv?: Record<string, unknown> } = {},
) {
  const calls: Calls = { rpc: [], kv: { ...(opts.kv ?? {}) }, warns: [] };
  const ctx = {
    plugin: { version: 'test' },
    tenant: { id: 'test-tenant' },
    config: { cisloSmlouvy: 'c', jmeno: 'j', heslo: 'h', ridePauseMs: 0, ...config },
    log: (level: string, msg: string) => {
      if (level === 'warn') calls.warns.push(msg);
    },
    fetch: vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      if (body.includes('vozidlaSeznam')) {
        return new Response(VEHICLE_LIST, { status: 200 });
      }
      // Codebook runs also ask for people and groups; empty lists are enough.
      if (body.includes('osobySeznam')) {
        return new Response(soap('osobySeznam', '<osoby></osoby>'), { status: 200 });
      }
      if (body.includes('skupinySeznam')) {
        return new Response(soap('skupinySeznam', '<skupiny></skupiny>'), { status: 200 });
      }
      // Match the id as a whole element value (`>11<`); a bare includes('11')
      // would also hit the date range and fail the wrong vehicle.
      const failing = failFor.find((id) => body.includes(`>${id}<`));
      if (failing !== undefined) {
        return new Response('upstream exploded', { status: 500 });
      }
      return new Response(RIDE_BOOK, { status: 200 });
    }),
    kv: {
      get: async (k: string) => calls.kv[k],
      set: async (k: string, v: unknown) => {
        calls.kv[k] = v;
      },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.rpc.push({ fn, args });
      if (fn === opts.rpcFail) throw new Error(`${fn} exploded`);
      return null;
    },
    schedule: () => undefined,
  };
  return { ctx, calls };
}

describe('cron.sync_rides', () => {
  it('stores every readable vehicle and advances the cursor when nothing failed', async () => {
    const { ctx, calls } = makeCtx();

    const result = (await handle(ctx as never, 'cron.sync_rides')) as {
      vehicles: number;
      rides: number;
      failed: number;
    };

    expect(result.vehicles).toBe(2);
    expect(result.failed).toBe(0);
    expect(calls.rpc.filter((c) => c.fn === 'tc_upsert_rides_audited')).toHaveLength(2);
    expect(calls.kv['tcars:last-ride-sync']).toBeTypeOf('string');
  });

  it('isolates a failing vehicle — the healthy one still lands', async () => {
    const { ctx, calls } = makeCtx([11]);

    const result = (await handle(ctx as never, 'cron.sync_rides')) as { rides: number; failed: number };

    expect(result.failed).toBe(1);
    // The second vehicle was reached despite the first one erroring out.
    expect(calls.rpc.filter((c) => c.fn === 'tc_upsert_rides_audited')).toHaveLength(1);
  });

  it('holds the cursor back when a vehicle failed, so the window is retried', async () => {
    const { ctx, calls } = makeCtx([11]);

    await handle(ctx as never, 'cron.sync_rides');

    expect(calls.kv['tcars:last-ride-sync']).toBeUndefined();
    expect(calls.warns.some((w) => w.includes('cursor held back'))).toBe(true);
  });

  it('stops at the call budget and keeps the window open', async () => {
    const { ctx, calls } = makeCtx([], { rideCallBudget: 1 });

    const result = (await handle(ctx as never, 'cron.sync_rides')) as { rides: number };

    // One vehicle fetched, the second never reached — so the cursor must not move.
    expect(result.rides).toBe(1);
    expect(calls.kv['tcars:last-ride-sync']).toBeUndefined();
    expect(calls.warns.some((w) => w.includes('budget exhausted'))).toBe(true);
  });
});

/** `datumOd` of every journey-log request the plugin sent to the vendor. */
function requestedFrom(ctx: ReturnType<typeof makeCtx>['ctx']): string[] {
  return ctx.fetch.mock.calls
    .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ''))
    .filter((body) => body.includes('knihaJizdVozidlo'))
    .map((body) => /<datumOd[^>]*>([^<]+)</.exec(body)?.[1] ?? '');
}

const HOUR = 3_600_000;

describe('cron.sync_rides — window with overlap (economical re-read)', () => {
  it('a normal tick re-reads a SHORT overlap before the cursor', async () => {
    const cursor = new Date(Date.now() - HOUR).toISOString();
    const { ctx, calls } = makeCtx([], {}, {
      kv: { 'tcars:last-ride-sync': cursor, 'tcars:last-ride-reconcile': new Date(Date.now() - HOUR).toISOString() },
    });

    const result = (await handle(ctx as never, 'cron.sync_rides')) as { reconcile: boolean };

    expect(result.reconcile).toBe(false);
    for (const from of requestedFrom(ctx)) {
      expect(Date.parse(cursor) - Date.parse(from)).toBe(2 * HOUR);
    }
    // The long overlap did not run, so its mark must not move either.
    expect(Date.parse(String(calls.kv['tcars:last-ride-reconcile']))).toBeLessThan(
      Date.parse(String(calls.kv['tcars:last-ride-sync'])),
    );
  });

  it('once a day the overlap reaches 48 h back to catch late vendor edits', async () => {
    const cursor = new Date(Date.now() - HOUR).toISOString();
    const stale = new Date(Date.now() - 21 * HOUR).toISOString();
    const { ctx, calls } = makeCtx([], {}, {
      kv: { 'tcars:last-ride-sync': cursor, 'tcars:last-ride-reconcile': stale },
    });

    const result = (await handle(ctx as never, 'cron.sync_rides')) as { reconcile: boolean };

    expect(result.reconcile).toBe(true);
    for (const from of requestedFrom(ctx)) {
      expect(Date.parse(cursor) - Date.parse(from)).toBe(48 * HOUR);
    }
    expect(calls.kv['tcars:last-ride-reconcile']).toBe(calls.kv['tcars:last-ride-sync']);
  });

  it('an unreadable cursor re-reads the backfill window instead of reading nothing', async () => {
    const { ctx, calls } = makeCtx([], { rideBackfillDays: 3 }, { kv: { 'tcars:last-ride-sync': 'rozbitý' } });

    await handle(ctx as never, 'cron.sync_rides');

    const froms = requestedFrom(ctx);
    expect(froms.length).toBe(2);
    for (const from of froms) {
      expect(Math.round((Date.now() - Date.parse(from)) / (24 * HOUR))).toBe(3);
    }
    expect(calls.warns.some((w) => w.includes('cursor unreadable'))).toBe(true);
  });
});

describe('cron.sync_rides — projection onto twins', () => {
  it('projects after every sync, also when the vendor had nothing new', async () => {
    const { ctx, calls } = makeCtx();

    await handle(ctx as never, 'cron.sync_rides');

    const projections = calls.rpc.filter((c) => c.fn === 'tc_project_rides');
    expect(projections).toEqual([{ fn: 'tc_project_rides', args: { p_okno_min: 180 } }]);
    // Projection reads what was stored, so it must come AFTER the upserts.
    expect(calls.rpc.at(-1)?.fn).toBe('tc_project_rides');
  });

  it('a failing projection fails the run LOUDLY — rides and cursor stay stored', async () => {
    const { ctx, calls } = makeCtx([], {}, { rpcFail: 'tc_project_rides' });

    // Not swallowed: the run ends failed, so the platform records an error
    // event and the source health block shows it.
    await expect(handle(ctx as never, 'cron.sync_rides')).rejects.toThrow(
      /jízdy uloženy, ale projekce na dvojčata selhala: tc_project_rides exploded/,
    );
    // …but nothing already done is undone.
    expect(calls.rpc.filter((c) => c.fn === 'tc_upsert_rides_audited')).toHaveLength(2);
    expect(calls.kv['tcars:last-ride-sync']).toBeTypeOf('string');
  });
});

describe('cron.sync_codebooks — identity proposals', () => {
  it('asks the platform for binding PROPOSALS after storing the codebook', async () => {
    const { ctx, calls } = makeCtx();

    await handle(ctx as never, 'cron.sync_codebooks');

    expect(calls.rpc.at(-1)).toEqual({ fn: 'tc_propose_identity', args: {} });
  });

  it('a failing proposal run fails LOUDLY after the codebook is stored', async () => {
    const { ctx, calls } = makeCtx([], {}, { rpcFail: 'tc_propose_identity' });

    await expect(handle(ctx as never, 'cron.sync_codebooks')).rejects.toThrow(
      /číselník uložen, ale návrhy vazeb identity selhaly: tc_propose_identity exploded/,
    );
    expect(calls.rpc.filter((c) => c.fn === 'tc_upsert_vehicles_audited')).toHaveLength(1);
    expect(calls.kv['tcars:last-codebook-sync']).toBeTypeOf('string');
  });
});
