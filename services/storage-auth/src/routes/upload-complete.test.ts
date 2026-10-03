/**
 * Unit testy routy `POST /upload-complete` — SPOUŠTĚČE antivirového skenu.
 *
 * Měří se to, co bylo na instanci rozbité: že se sken vůbec spustí, že ho smí
 * spustit jen vlastník nahrávky, a že se při nečistém nebo NEPROVEDENÉM skenu
 * nepromuje (fail-closed). `documentId` se nebere na slovo — ověřuje se čtením
 * pod tokenem uživatele, takže cizí id nevrátí řádek a verdikt do cizí evidence
 * nespadne.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockVerifyToken, mockPromuj, mockStat, mockZapis } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockPromuj: vi.fn(),
  mockStat: vi.fn(),
  mockZapis: vi.fn(),
}));

class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function isAdminOrStaff(user: { roles: string[] }): boolean {
  return user.roles.includes('admin') || user.roles.includes('staff');
}

vi.mock('../auth.js', () => ({ AuthError, verifyToken: mockVerifyToken, isAdminOrStaff }));
vi.mock('../minio.js', () => ({ statObjectOrNull: mockStat }));
// Hranice je sdílený pomocník `promujZKaranteny` (lib/promoce.ts) — ten volá
// scanAndPromote se stropem skenu a má vlastní tvar výsledku. Tady se měří routa:
// kdo smí sken spustit, idempotence a převod výsledku na HTTP kód.
vi.mock('../lib/promoce.js', () => ({ promujZKaranteny: mockPromuj }));
// Evidence médií (lib/media-zaznam.ts) má vlastní testy; tady se měří, KDY ji routa
// volá a že bez záznamu veřejný obrázek NEKONČÍ úspěchem (galerie by ho neznala).
vi.mock('../lib/media-zaznam.js', () => ({ zapisMedium: mockZapis }));

/**
 * Odchozí volání jde přes SSRF guard (`lib/guarded-fetch.ts`), ne holým `fetch` —
 * to je pravidlo repa pro nový odchozí povrch. Guard má vlastní testy v balíčku
 * `@aisha/security`; tady se mockuje JEN ta hranice, aby test měřil chování routy
 * (ověření páru id↔cesta pod tokenem uživatele), ne síť.
 */
vi.mock('../lib/guarded-fetch.js', () => ({
  guardedFetch: (url: string, init?: RequestInit) => (globalThis.fetch as typeof fetch)(url, init),
}));

vi.mock('../config.js', () => ({
  config: {
    publicBuckets: new Set(['page-assets', 'hero-images']),
    privateBuckets: new Set(['health-documents']),
    uploadsQuarantineBucket: 'uploads-quarantine',
    postgrestUrl: 'http://postgrest:3000',
  },
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { post } as unknown as Parameters<typeof import('./upload-complete.js').uploadCompleteRoute>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function ohlas(body: unknown, authHeader = 'Bearer test.jwt') {
  const { uploadCompleteRoute } = await import('./upload-complete.js');
  const { app, handlers } = makeApp();
  await uploadCompleteRoute(app, {} as never);
  const { reply, calls } = makeReply();
  const req = {
    headers: { authorization: authHeader },
    body,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  await handlers.get('/upload-complete')!(req, reply);
  return calls;
}

const CISTY = { stav: 'cisty' as const, bucket: 'page-assets', klic: 'user-1/uuid_x.png' };
const V_KARANTENE = { size: 3, lastModified: new Date(0), metaData: {} };

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockPromuj.mockReset();
  mockStat.mockReset();
  mockZapis.mockReset();
  mockZapis.mockResolvedValue(undefined);
  mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['admin'], claims: {} });
  mockPromuj.mockResolvedValue(CISTY);
  // Výchozí stav: objekt je v karanténě (presigned cesta, sken ještě neproběhl).
  mockStat.mockResolvedValue(V_KARANTENE);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => vi.restoreAllMocks());

describe('spuštění skenu', () => {
  it('čistý objekt se promuje a vrátí se cílový klíč', async () => {
    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBeNull();
    expect(calls.body).toEqual({ bucket: 'page-assets', objectKey: 'user-1/uuid_x.png', status: 'clean' });
    expect(mockPromuj).toHaveBeenCalledWith('page-assets/user-1/uuid_x.png', null);
  });

  it('infikovaný objekt = 422 a žádná adresa', async () => {
    mockPromuj.mockResolvedValue({ stav: 'infikovany', podpis: 'Eicar-Test-Signature' });

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBe(422);
    expect((calls.body as { error: string }).error).toBe('infected');
  });

  it('NEPROVEDENÝ sken = 502, ne úspěch (fail-closed)', async () => {
    mockPromuj.mockResolvedValue({ stav: 'nedokonceno', duvod: 'clamd scan exceeded 60000ms' });

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBe(502);
    expect((calls.body as { error: string }).error).toBe('scan_unavailable');
  });
});

describe('kdo smí sken spustit', () => {
  it('401 bez platného tokenu', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'Missing bearer token'));

    const calls = await ohlas({ objectKey: 'page-assets/user-1/x.png' }, '');

    expect(calls.status).toBe(401);
    expect(mockPromuj).not.toHaveBeenCalled();
  });

  it('403 na CIZÍ klíč — vlastnictví se čte z klíče, ne z těla', async () => {
    const calls = await ohlas({ objectKey: 'page-assets/user-2/uuid_x.png' });

    expect(calls.status).toBe(403);
    expect(mockPromuj, 'cizí nahrávku nesmí nechat promovat ani admin').not.toHaveBeenCalled();
  });

  it('403 pro člena bez role u veřejného bucketu', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBe(403);
    expect(mockPromuj).not.toHaveBeenCalled();
  });

  it('400 na klíč bez cílového bucketu a na neznámý bucket', async () => {
    expect((await ohlas({ objectKey: 'bezlomitka' })).status).toBe(400);
    expect((await ohlas({ objectKey: 'vymysleny/user-1/x.png' })).status).toBe(400);
    expect(mockPromuj).not.toHaveBeenCalled();
  });
});

describe('documentId se ověřuje, ne věří', () => {
  it('pár (id, cesta) se čte POD TOKENEM UŽIVATELE a předá se skenu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'doc-1' }] });
    vi.stubGlobal('fetch', fetchMock);
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });
    mockPromuj.mockResolvedValue({ ...CISTY, bucket: 'health-documents' });

    const calls = await ohlas({ objectKey: 'health-documents/user-1/uuid_x.pdf', documentId: 'doc-1' });

    expect(calls.status).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('/member_health_documents');
    expect(url).toContain('file_path=eq.');
    expect(init.headers.Authorization, 'čte se JEHO tokenem, aby RLS pustila jen jeho řádky').toBe('Bearer test.jwt');
    expect(mockPromuj).toHaveBeenCalledWith('health-documents/user-1/uuid_x.pdf', 'doc-1');
  });

  it('403, když k té cestě řádek nepatří — verdikt do cizí evidence nespadne', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });

    const calls = await ohlas({ objectKey: 'health-documents/user-1/uuid_x.pdf', documentId: 'cizi-doc' });

    expect(calls.status).toBe(403);
    expect(mockPromuj).not.toHaveBeenCalled();
  });
});

describe('idempotence — objekt už promovaný přes /nahrani', () => {
  /**
   * Přes API se objekt oskenuje a promuje na konci PUTu, takže v karanténě NENÍ.
   * Webový klient ale tuhle routu volá vždy, protože neví, kudy jeho PUT šel —
   * hotový výsledek tedy nesmí skončit chybou.
   */
  it('200 s konečným klíčem, když objekt v karanténě není, ale v cíli ano', async () => {
    mockStat
      .mockResolvedValueOnce(null) // karanténa: prázdno
      .mockResolvedValueOnce({ size: 3, lastModified: new Date(0), metaData: {} }); // cíl: je

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBeNull();
    expect(calls.body).toEqual({ bucket: 'page-assets', objectKey: 'user-1/uuid_x.png', status: 'clean' });
    expect(mockPromuj, 'podruhé se neskenuje').not.toHaveBeenCalled();
  });

  it('404, když objekt není ani v karanténě, ani v cíli', async () => {
    mockStat.mockResolvedValue(null);

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBe(404);
    expect(mockPromuj).not.toHaveBeenCalled();
  });

  it('idempotence neobchází vlastnictví — cizí klíč je 403 i pro hotový objekt', async () => {
    mockStat.mockResolvedValueOnce(null).mockResolvedValueOnce({ size: 3, lastModified: new Date(0), metaData: {} });

    const calls = await ohlas({ objectKey: 'page-assets/user-2/uuid_x.png' });

    expect(calls.status).toBe(403);
    expect(mockStat, 'na cizí objekt se ani nesahá').not.toHaveBeenCalled();
  });
});

/**
 * Evidence médií (2026-09-24): veřejný bucket = obsah webu. Záznam vzniká po čisté
 * promoci i v idempotentní větvi (přes API mohl na konci PUTu selhat a tohle ohlášení
 * je jeho opakování). Bez záznamu končí 502 — obrázek bez evidence by v galerii chyběl.
 */
describe('evidence médií pro veřejný bucket', () => {
  it('po čisté promoci se zapíše s bajty a typem z karantény', async () => {
    mockStat.mockResolvedValue({ size: 42, lastModified: new Date(0), metaData: { 'content-type': 'image/png' } });

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBeNull();
    expect(mockZapis).toHaveBeenCalledWith({ bucket: 'page-assets', objectKey: 'user-1/uuid_x.png', contentType: 'image/png', bytes: 42 });
  });

  it('idempotentní větev záznam zopakuje', async () => {
    mockStat
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ size: 7, lastModified: new Date(0), metaData: { 'content-type': 'image/jpeg' } });

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBeNull();
    expect(mockZapis).toHaveBeenCalledWith({ bucket: 'page-assets', objectKey: 'user-1/uuid_x.png', contentType: 'image/jpeg', bytes: 7 });
  });

  it('selhání záznamu = 502 media_record_failed, ne úspěch', async () => {
    mockZapis.mockRejectedValue(new Error('record_media_asset failed: 401'));

    const calls = await ohlas({ objectKey: 'page-assets/user-1/uuid_x.png' });

    expect(calls.status).toBe(502);
    expect((calls.body as { error: string }).error).toBe('media_record_failed');
  });

  it('privátní bucket se nezapisuje', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'doc-1' }] }));
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });
    mockPromuj.mockResolvedValue({ ...CISTY, bucket: 'health-documents' });

    await ohlas({ objectKey: 'health-documents/user-1/uuid_x.pdf', documentId: 'doc-1' });

    expect(mockZapis).not.toHaveBeenCalled();
  });
});
