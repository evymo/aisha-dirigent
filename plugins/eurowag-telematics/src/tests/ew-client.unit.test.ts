import { describe, it, expect, vi } from 'vitest';
import { EwClient, EwApiError, EW_DEFAULT_USER_AGENT, odometerKm, consumptionLiters, consumptionPer100km, utcIso } from '../ew-client.js';

const CREDS = { apiKey: 'test-key', username: 'u', password: 'p' };
const OPTS = {
  baseUrl: 'https://telematics.example.test/customer-api/v1',
  tokenUrl: 'https://login.example.test/token',
  clientId: 'cid',
  timeoutMs: 5000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('EwClient — auth', () => {
  it('mints a bearer with a password grant and reuses it until it nears expiry', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/token') ? jsonResponse({ access_token: 't1', expires_in: 300 }) : jsonResponse({ ok: true }));
    const c = new EwClient(CREDS, { ...OPTS, fetchImpl });

    await c.get('vehicles-states');
    await c.get('drivers');

    const tokenCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('/token'));
    expect(tokenCalls, 'a 5-minute token must not be re-minted per request').toHaveLength(1);
    const [, init] = tokenCalls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('grant_type=password');
    expect(String(init.body)).toContain('client_id=cid');
  });

  it('re-mints once the cached token falls inside the refresh skew', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/token') ? jsonResponse({ access_token: 't', expires_in: 60 }) : jsonResponse({}));
    const c = new EwClient(CREDS, { ...OPTS, fetchImpl, refreshSkewS: 30 });

    await c.token(0);
    await c.token(29_000);       // still inside the 30s validity window
    await c.token(31_000);       // past it

    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('/token'))).toHaveLength(2);
  });

  it('treats a token of unknown lifetime as short-lived, never long-lived', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 't' })); // no expires_in
    const c = new EwClient(CREDS, { ...OPTS, fetchImpl });
    await c.token(0);
    await c.token(61_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a 200 that carries no access_token rather than sending "undefined"', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ token_type: 'Bearer' }));
    await expect(new EwClient(CREDS, { ...OPTS, fetchImpl }).token()).rejects.toThrow(EwApiError);
  });
});

describe('EwClient — requests', () => {
  it('appends api_key to every call so no caller can forget it', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (!url.includes('/token')) seen.push(url);
      return url.includes('/token') ? jsonResponse({ access_token: 't', expires_in: 300 }) : jsonResponse({});
    });
    const c = new EwClient(CREDS, { ...OPTS, fetchImpl });

    await c.vehiclesStates();
    await c.trips(530328, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');

    expect(seen).toHaveLength(2);
    for (const u of seen) expect(new URL(u).searchParams.get('api_key')).toBe('test-key');
    // trips jsou per-vozidlo a okno je snake_case — camelCase API tiše ignoruje
    const tripsUrl = new URL(seen[1]);
    expect(tripsUrl.searchParams.get('monitored_object_id')).toBe('530328');
    expect(tripsUrl.searchParams.get('date_from')).toBe('2026-01-01T00:00:00Z');
    expect(tripsUrl.searchParams.get('date_to')).toBe('2026-01-02T00:00:00Z');
  });

  it('sends the bearer and surfaces a non-2xx as EwApiError', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/token') ? jsonResponse({ access_token: 'tok', expires_in: 300 })
                             : new Response('forbidden', { status: 403 }));
    const c = new EwClient(CREDS, { ...OPTS, fetchImpl });
    await expect(c.drivers()).rejects.toThrow(/EW_API_403/);
    const [, init] = fetchImpl.mock.calls.find(([u]) => !String(u).includes('/token')) as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});

// These encode field behaviour measured on 1031 real trips — see the client header.
describe('normalisation of fields that lie', () => {
  it('converts the odometer from metres', () => {
    expect(odometerKm(377_261_330)).toBeCloseTo(377_261.33, 2);
    expect(odometerKm(null)).toBeNull();
  });

  it('rejects the -1 "unknown" sentinel that is present on 100% of records', () => {
    expect(consumptionLiters(-1)).toBeNull();
    expect(consumptionLiters(42.5)).toBe(42.5);
  });

  it('rejects a physically impossible per-100km figure', () => {
    expect(consumptionPer100km(281.69)).toBeNull();
    expect(consumptionPer100km(0)).toBeNull();
    expect(consumptionPer100km(31.2)).toBe(31.2);
  });
});

describe('0.2.1 — User-Agent a Cloudflare', () => {
  const ua = (init: RequestInit) => (init.headers as Record<string, string>)['user-agent'];

  it('posílá prohlížečový UA na token i API — sandbox žádný nepřidá a Cloudflare knihovní odmítne', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/token') ? jsonResponse({ access_token: 't', expires_in: 300 }) : jsonResponse([]));
    await new EwClient(CREDS, { ...OPTS, fetchImpl }).vehiclesStates();
    const inits = fetchImpl.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1]);
    expect(inits).toHaveLength(2);
    for (const init of inits) expect(ua(init)).toBe(EW_DEFAULT_USER_AGENT);
    expect(EW_DEFAULT_USER_AGENT).toMatch(/^Mozilla\//);

    const own = vi.fn(async (url: string) =>
      url.includes('/token') ? jsonResponse({ access_token: 't', expires_in: 300 }) : jsonResponse([]));
    await new EwClient(CREDS, { ...OPTS, userAgent: 'aisha-test/1', fetchImpl: own }).vehiclesStates();
    expect(ua((own.mock.calls[0] as unknown as [string, RequestInit])[1])).toBe('aisha-test/1');
  });

  it('challenge stránku Cloudflaru pojmenuje, místo aby hlásila začátek HTML', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<!DOCTYPE html><html><head><title>Just a moment...</title>', { status: 403 }));
    await expect(new EwClient(CREDS, { ...OPTS, fetchImpl }).token()).rejects.toThrow(/Cloudflare odmítl/);
  });

  it('nekonečné stránkování zastaví nahlas, nepropálí denní rozpočet', async () => {
    const plna = Array.from({ length: 29 }, (_, i) => ({ id: i }));
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/token') ? jsonResponse({ access_token: 't', expires_in: 300 }) : jsonResponse(plna));
    const c = new EwClient(CREDS, { ...OPTS, maxPages: 3, fetchImpl });
    await expect(c.trips(1, 'a', 'b')).rejects.toThrow(/stránkování neskončilo po 3/);
    expect(c.calls).toBe(3);
  });
});

describe('0.2.1 — časy jízd bez zóny jsou UTC', () => {
  it('doplní Z jen tam, kde zóna chybí', () => {
    expect(utcIso('2026-09-28T10:11:09')).toBe('2026-09-28T10:11:09Z');
    expect(utcIso('2026-09-28T10:11:09+00:00')).toBe('2026-09-28T10:11:09+00:00');
    expect(utcIso('2026-09-28T10:11:09.5Z')).toBe('2026-09-28T10:11:09.5Z');
    expect(utcIso('nesmysl')).toBeNull();
    expect(utcIso(null)).toBeNull();
  });
});
