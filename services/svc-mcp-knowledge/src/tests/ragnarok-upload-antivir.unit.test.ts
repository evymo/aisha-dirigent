/**
 * /ragnarok/upload — soubor se skenuje PŘED předáním vyhledávacímu enginu.
 *
 * ⛔ NAMĚŘENO 2026-10-03: route předávala buffer enginu bez antiviru (antivirem
 * procházely jen nahrávky přes storage-auth). Testy tvrdí vlastnost, ne zapojení:
 *   · dál se dostane JEN soubor s verdiktem `clean`;
 *   · nález → 422 a engine NEDOSTANE nic;
 *   · neprovedený sken (clamd dole, cíl nedoručen) → 503 a engine NEDOSTANE nic
 *     — fail-closed, žádné „pusť to, když antivir neodpovídá";
 *   · vypnout sken umí jen doslovné AV_SCAN_ENABLED=false (a je to slyšet) — a jen mimo
 *     produkci; v produkci vypnutý sken nahrání ODMÍTNE.
 * Kontrolní vzorek: čistý soubor k enginu DOJDE — jinak by „nic nedošlo" prošlo
 * i nad rozbitou routou.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let Fastify: typeof import('fastify').default | null = null;
let multipart: typeof import('@fastify/multipart').default | null = null;
try {
  Fastify = (await import('fastify')).default;
  multipart = (await import('@fastify/multipart')).default;
} catch {
  Fastify = null;
}
const describeIfFastify = Fastify && multipart ? describe : describe.skip;

const verifyTokenMock = vi.hoisted(() => vi.fn());
const isAdminOrStaffMock = vi.hoisted(() => vi.fn());
vi.mock('../auth.js', () => ({
  verifyToken: verifyTokenMock,
  verifyServiceRole: vi.fn(() => {
    throw new Error('not a service token');
  }),
  isAdminOrStaff: isAdminOrStaffMock,
  AuthError: class extends Error {},
}));

const cfg = vi.hoisted(() => ({
  ragnarokUrl: 'http://ragnarok.test:9696',
  ragnarokApiKey: 'test-ragnarok-key',
  ragnarokDefaultProjectId: 'aisha',
  clamdHost: 'clamd.test',
  clamdPort: 3310,
  avScanEnabled: true,
  produkce: false,
  uploadScanBudgetMs: 1000,
}));
vi.mock('../config.js', () => ({ config: cfg }));

const scanBufferMock = vi.hoisted(() => vi.fn());
vi.mock('@aisha/security/av-scan', () => ({ scanBuffer: scanBufferMock }));

import { ragnarokRoutes } from '../routes/ragnarok.js';

const fetchMock = vi.fn();
const OBSAH = 'obsah souboru pro znalostní bázi';

function multipartTelo(): { payload: Buffer; headers: Record<string, string> } {
  const hranice = '----hranice-testu';
  const payload = Buffer.from(
    `--${hranice}\r\nContent-Disposition: form-data; name="file"; filename="poznamky.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n${OBSAH}\r\n--${hranice}--\r\n`,
    'utf8',
  );
  return {
    payload,
    headers: { authorization: 'Bearer t', 'content-type': `multipart/form-data; boundary=${hranice}` },
  };
}

async function nahraj() {
  const app = Fastify!({ logger: false });
  await app.register(multipart!);
  await ragnarokRoutes(app);
  const res = await app.inject({ method: 'POST', url: '/ragnarok/upload', ...multipartTelo() });
  await app.close();
  return res;
}

describeIfFastify('/ragnarok/upload — antivir před enginem', () => {
  beforeEach(() => {
    verifyTokenMock.mockResolvedValue({ sub: 'u1' });
    isAdminOrStaffMock.mockReturnValue(true);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ kb_id: 'k1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(cfg, { clamdHost: 'clamd.test', clamdPort: 3310, avScanEnabled: true, produkce: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('čistý soubor: skenuje se CELÝ obsah proti doručenému cíli a engine ho dostane', async () => {
    scanBufferMock.mockResolvedValue({ status: 'clean' });
    const res = await nahraj();

    expect(res.statusCode).toBe(201);
    expect(scanBufferMock).toHaveBeenCalledTimes(1);
    const [data, cil] = scanBufferMock.mock.calls[0] as [Buffer, Record<string, unknown>];
    expect(data.toString('utf8')).toBe(OBSAH);
    expect(cil).toEqual({ host: 'clamd.test', port: 3310, timeoutMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // sken PŘED předáním, ne po něm
    expect(scanBufferMock.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('nález: 422 se jménem signatury a engine nedostane nic', async () => {
    scanBufferMock.mockResolvedValue({ status: 'infected', signature: 'Eicar-Test-Signature' });
    const res = await nahraj();

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'av_infected', signature: 'Eicar-Test-Signature' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sken neproběhl (clamd neodpovídá): 503 a engine nedostane nic', async () => {
    scanBufferMock.mockResolvedValue({ status: 'error', reason: 'clamd unreachable: ECONNREFUSED' });
    const res = await nahraj();

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'av_unavailable' });
    // důvod je věc provozu, ne uživatele — adresa clamd do odpovědi nepatří
    expect(JSON.stringify(res.json())).not.toContain('ECONNREFUSED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['prázdné jméno', { clamdHost: '' }],
    ['nedoručený port', { clamdPort: Number.NaN }],
  ])('cíl nedoručen (%s): 503 BEZ pokusu o spojení — prázdné jméno není localhost', async (_n, zmena) => {
    Object.assign(cfg, zmena);
    const res = await nahraj();

    expect(res.statusCode).toBe(503);
    expect(scanBufferMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('výslovně vypnutý sken (AV_SCAN_ENABLED=false) soubor pustí bez skenu — jen MIMO produkci', async () => {
    Object.assign(cfg, { avScanEnabled: false });
    const res = await nahraj();

    expect(res.statusCode).toBe(201);
    expect(scanBufferMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('týž vypínač v PRODUKCI soubor nepustí: 503 a engine nedostane nic', async () => {
    Object.assign(cfg, { avScanEnabled: false, produkce: true });
    const res = await nahraj();

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'av_disabled' });
    expect(scanBufferMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('soubor nad limit antiviru je vada SOUBORU (413), ne „antivir nedostupný"', async () => {
    scanBufferMock.mockResolvedValue({ status: 'error', reason: 'INSTREAM size limit exceeded. ERROR', kind: 'size_limit' });
    const res = await nahraj();

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'av_too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
