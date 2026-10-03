/**
 * Unit tests for svc-packeta POST /packeta-api — the single-function action
 * dispatcher used by the web hooks. Verifies that each action routes to the
 * right operation with the client field names normalized, and that unknown /
 * missing actions are rejected with 400.
 *
 * Boundaries mocked: auth (verifyToken), the Packeta feed helpers, the
 * PostgREST RPC client, and the global `fetch` used to reach the Packeta XML
 * API. No network, deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Boundary mocks ────────────────────────────────────────────────────────

const verifyToken = vi.fn(async (_authHeader?: string) => ({ userId: 'user-1', roles: [] as string[], claims: {} }));
vi.mock('../auth.js', () => ({ verifyToken: (h?: string) => verifyToken(h) }));

const getBranches = vi.fn();
const getCarriers = vi.fn();
const calculateShippingCost = vi.fn();
vi.mock('../packeta-feed.js', () => ({
  getBranches: () => getBranches(),
  getCarriers: () => getCarriers(),
  calculateShippingCost: (t: number) => calculateShippingCost(t),
  // sortByDistance is imported by the route but unused in these tests; provide
  // an identity-ish stub so the import resolves.
  sortByDistance: (branches: unknown[]) => branches,
}));

// `commerce_base_currency` is a scalar RPC (RETURNS text) that resolveBaseCurrency()
// reads for the instance base currency; PostgREST returns the bare scalar, so the
// mock must too. Every other RPC here is asserted by call, not return value, so `{}`
// is fine. The base-currency resolver caches per-process, so this must be correct
// from the first call.
const rpcService = vi.fn(async (fn: string, _params: unknown) =>
  fn === 'commerce_base_currency' ? 'CZK' : ({}),
);
vi.mock('../postgrest.js', () => ({ rpcService: (fn: string, p: unknown) => rpcService(fn, p) }));

// ⛔ SSRF STRÁŽCE SE MUSÍ MOCKOVAT, JINAK TENHLE TEST SÁHNE NA SÍŤ (naměřeno 2026-09-06).
// Routa nevolá `fetch` přímo, ale přes `ssrfGuard.safeFetch`, a ten si cílový host
// NEJDŘÍV PŘELOŽÍ (packages/security/src/ssrf.ts: `await lookup(host)`) — ochrana
// proti DNS rebindingu. Výchozí `PACKETA_API_URL` míří na `www.zasilkovna.cz`,
// takže stub globálního `fetch` níž se vůbec nedostal ke slovu: bez funkčního DNS
// hodil strážce SsrfBlockedError, handler vrátil 500 a `fetchMock` zůstal nedotčený
// (druhý příznak: `Cannot read properties of undefined (reading '1')`).
//
// Projevovalo se to jako NÁHODNÉ padání čtyř testů v pre-pushi, zatímco sólo běh
// procházel 13/13 — rozdíl nebyl v zátěži, ale v tom, jestli zrovna odpověděl
// resolver. Unit test nesmí stát na síti (CLAUDE.md: „Avoid relying on external
// services, network, or timing in unit tests").
//
// `importOriginal` schválně: nahrazuje se JEN strážce, zbytek `@aisha/security`
// zůstává skutečný (routa si odtud bere i `parseHostAllowlist`, a další moduly
// v grafu mohou potřebovat cokoli jiného). `safeFetch` deleguje na globální
// `fetch`, takže všechna dosavadní tvrzení nad `fetchMock.mock.calls` platí dál.
vi.mock('@aisha/security', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSsrfGuard: () => ({
    safeFetch: (url: string, init?: RequestInit) => fetch(url, init),
  }),
}));

// packeta-api imports config (real defaults are fine — fetch is stubbed).

import { packetaApiRoutes, splitRecipientName } from '../routes/packeta-api.js';

// ── Fetch stub (Packeta XML API boundary) ─────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;
function stubFetch(status: number, text: string): void {
  fetchMock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));
  vi.stubGlobal('fetch', fetchMock);
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(packetaApiRoutes);
  await app.ready();
  return app;
}

async function post(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/packeta-api',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    payload: body as Record<string, unknown>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyToken.mockResolvedValue({ userId: 'user-1', roles: [], claims: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /packeta-api dispatcher', () => {
  it("action='pickup-points' → filters branches by country, returns { points, total }", async () => {
    getBranches.mockResolvedValue([
      { id: '1', country: 'cz', type: 'branch' },
      { id: '2', country: 'sk', type: 'branch' },
      { id: '3', country: 'cz', type: 'zbox' },
    ]);
    const app = await buildApp();

    const res = await post(app, { action: 'pickup-points', country: 'CZ' });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.total).toBe(2); // only the two cz points
    expect(json.points.map((p: { id: string }) => p.id)).toEqual(['1', '3']);
    expect(getBranches).toHaveBeenCalledOnce();
    await app.close();
  });

  it("action='available-methods' → normalizes orderSubtotal → order_total for cost calc", async () => {
    getBranches.mockResolvedValue([
      { id: '1', country: 'cz', type: 'branch' },
      { id: '2', country: 'cz', type: 'zbox' },
    ]);
    getCarriers.mockResolvedValue([
      { id: 'c1', name: 'Carrier CZ', country: 'cz', maxWeight: 30, pickupPoints: true },
    ]);
    calculateShippingCost.mockReturnValue(0);
    const app = await buildApp();

    const res = await post(app, {
      action: 'available-methods',
      country: 'CZ',
      currency: 'CZK',
      orderSubtotal: 2000,
      weightGrams: 500,
    });

    expect(res.statusCode).toBe(200);
    // The client's orderSubtotal must reach the cost calc as the order total.
    expect(calculateShippingCost).toHaveBeenCalledWith(2000);
    const json = res.json();
    expect(json.pickup_points).toEqual({ branches: 1, zboxes: 1 });
    expect(json.carriers).toEqual([
      { id: 'c1', name: 'Carrier CZ', max_weight_kg: 30, pickup_points: true },
    ]);
    expect(json.shipping_cost).toBe(0);
    expect(json.free_shipping_from).toBe(2000); // free shipping → subtotal echoed
    expect(json.currency).toBe('CZK');
    await app.close();
  });

  it("action='create-packet' → normalizes orderId→order_id, name split, branchId→addressId", async () => {
    stubFetch(200, '<response><id>987654</id><barcode>Z1234567890</barcode></response>');
    const app = await buildApp();

    const res = await post(app, {
      action: 'create-packet',
      orderId: 'order-abc',
      recipient: {
        name: 'John Doe Smith',
        email: 'john@example.com',
        phone: '+420123456789',
        street: 'Main 1',
        city: 'Prague',
        zip: '11000',
        country: 'CZ',
      },
      weight: 1.5,
      value: 999,
      branchId: 4242,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ packet_id: '987654', barcode: 'Z1234567890', status: 'created' });

    // Assert the normalized fields reached the Packeta XML boundary.
    expect(fetchMock).toHaveBeenCalledOnce();
    const sentXml = fetchMock.mock.calls[0][1].body as string;
    expect(sentXml).toContain('<number>order-abc</number>'); // orderId → order_id → <number>
    expect(sentXml).toContain('<name>John Doe</name>');        // last-space split, given name(s)
    expect(sentXml).toContain('<surname>Smith</surname>');     // last token = surname
    expect(sentXml).toContain('<addressId>4242</addressId>');  // branchId → addressId (stringified)

    // Shipment record persisted with the normalized order id + verified user.
    expect(rpcService).toHaveBeenCalledWith('create_shipment_record', expect.objectContaining({
      p_order_id: 'order-abc',
      p_external_id: '987654',
      p_user_id: 'user-1',
      p_carrier: 'packeta',
      p_status: 'created',
    }));
    await app.close();
  });

  it("action='create-packet' → forwards cod + note into the Packeta XML", async () => {
    stubFetch(200, '<response><id>123</id><barcode>Z9</barcode></response>');
    const app = await buildApp();

    const res = await post(app, {
      action: 'create-packet',
      orderId: 'order-cod',
      recipient: { name: 'Jan Novak', email: 'jan@e.com', phone: '1' },
      weight: 2,
      value: 1500,
      branchId: 7,
      cod: 1500,
      note: 'Fragile & <handle>',
    });

    expect(res.statusCode).toBe(200);
    const sentXml = fetchMock.mock.calls[0][1].body as string;
    expect(sentXml).toContain('<cod>1500</cod>');                       // COD amount forwarded
    expect(sentXml).toContain('<note>Fragile &amp; &lt;handle&gt;</note>'); // note forwarded + escaped
    await app.close();
  });

  it("action='create-packet' without cod/note → omits both XML tags", async () => {
    stubFetch(200, '<response><id>124</id></response>');
    const app = await buildApp();

    await post(app, {
      action: 'create-packet',
      orderId: 'order-nocod',
      recipient: { name: 'Jan Novak', email: 'jan@e.com', phone: '1' },
      weight: 1,
      value: 100,
      branchId: 1,
    });

    const sentXml = fetchMock.mock.calls[0][1].body as string;
    expect(sentXml).not.toContain('<cod>');
    expect(sentXml).not.toContain('<note>');
    await app.close();
  });

  it("action='create-packet' with single-word name → 400 (surname required)", async () => {
    stubFetch(200, '<response><id>1</id></response>');
    const app = await buildApp();

    const res = await post(app, {
      action: 'create-packet',
      orderId: 'order-x',
      recipient: { name: 'Cher', email: 'c@e.com', phone: '1' },
      weight: 1,
      value: 1,
      branchId: 1,
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled(); // rejected before hitting Packeta
    await app.close();
  });

  it("action='track' → normalizes body.packetId to the tracked id", async () => {
    stubFetch(200, '<packetTracking><record><dateTime>2026-01-01</dateTime><statusId>1</statusId><statusName>Received</statusName></record></packetTracking>');
    const app = await buildApp();

    const res = await post(app, { action: 'track', packetId: 555111 });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.packet_id).toBe('555111');
    expect(json.tracking).toEqual([
      { dateTime: '2026-01-01', statusId: '1', statusText: 'Received', branchId: undefined },
    ]);
    const sentXml = fetchMock.mock.calls[0][1].body as string;
    expect(sentXml).toContain('<packetId>555111</packetId>');
    await app.close();
  });

  it("action='track' → extracts branchId from <destination> and falls back to <note> for status", async () => {
    // Reconciliation guard: /packeta-api and GET /track must extract the SAME
    // tags via the shared parseTrackingXml (statusName||note, destination).
    stubFetch(
      200,
      '<packetTracking><record><dateTime>2026-02-02</dateTime><statusId>4</statusId><note>Handover</note><destination>BR-99</destination></record></packetTracking>',
    );
    const app = await buildApp();

    const res = await post(app, { action: 'track', packetId: 777 });

    expect(res.statusCode).toBe(200);
    expect(res.json().tracking).toEqual([
      { dateTime: '2026-02-02', statusId: '4', statusText: 'Handover', branchId: 'BR-99' },
    ]);
    await app.close();
  });

  it('rejects unknown action → 400', async () => {
    const app = await buildApp();
    const res = await post(app, { action: 'delete-everything' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('delete-everything');
    await app.close();
  });

  it('rejects missing action → 400', async () => {
    const app = await buildApp();
    const res = await post(app, { country: 'CZ' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('splitRecipientName normalization', () => {
  it('splits on the last whitespace run', () => {
    expect(splitRecipientName('John Doe Smith')).toEqual({ name: 'John Doe', surname: 'Smith' });
    expect(splitRecipientName('Jane Doe')).toEqual({ name: 'Jane', surname: 'Doe' });
  });

  it('collapses inner whitespace and trims', () => {
    expect(splitRecipientName('  John   Doe  ')).toEqual({ name: 'John', surname: 'Doe' });
  });

  it('single token yields empty surname (caller rejects)', () => {
    expect(splitRecipientName('Cher')).toEqual({ name: 'Cher', surname: '' });
    expect(splitRecipientName('   ')).toEqual({ name: '', surname: '' });
  });
});
