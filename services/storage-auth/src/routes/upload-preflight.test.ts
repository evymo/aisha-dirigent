/**
 * Unit tests for storage-auth upload-preflight route (`POST /upload-preflight`).
 *
 * Focus: the health-document preflight branch (reached via the gateway's
 * `upload-health-document-preflight` → `/upload-preflight` rewrite, i.e. a body with
 * NO `bucket`). It must:
 *   (a) persist the member_health_documents row via create_health_document_preflight_audited
 *       (correct param names, NO p_user_id — the RPC derives owner from auth.uid()),
 *   (b) return a MinIO presigned PUT target { documentId, uploadUrl, objectKey, bucket,
 *       mimeType, expiresIn } — NOT a legacy hosted-storage signed-URL token,
 *   (c) reject a bad body (400) and an unsupported MIME type (415),
 *   (d) reject missing/invalid auth (401).
 *
 * auth, MinIO, and the PostgREST RPC (global fetch) are mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockVerifyToken, mockCreateSignedUploadUrl } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockCreateSignedUploadUrl: vi.fn(),
}));

/**
 * Role se čtou z JWT — tady se tedy NEMOCKUJE, ale použije se ta SKUTEČNÁ
 * funkce: `isAdminOrStaff` je čistý predikát nad `roles` a mock by z testu
 * odstranil právě to, co se měří. (Do 2026-09-21 v tomhle mocku chyběla úplně
 * a testy prošly jen proto, že se k veřejnému bucketu nikdy nedostaly.)
 */
function isAdminOrStaff(user: { roles: string[] }): boolean {
  return user.roles.includes('admin') || user.roles.includes('staff');
}

// Local AuthError the route checks with `instanceof`.
class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

vi.mock('../auth.js', () => ({
  AuthError,
  verifyToken: mockVerifyToken,
  isAdminOrStaff,
}));

vi.mock('../minio.js', () => ({
  createSignedUploadUrl: mockCreateSignedUploadUrl,
}));

vi.mock('../config.js', () => ({
  config: {
    postgrestUrl: 'http://postgrest:3000',
    uploadUrlTtlSeconds: 7200,
    maxFileSizeMb: 50,
    privateBuckets: new Set(['health-documents', 'wearable-analysis']),
    publicBuckets: new Set(['hero-images']),
    uploadsQuarantineBucket: 'uploads-quarantine',
    allowedMimeTypes: new Set(['application/pdf', 'image/png']),
  },
}));

// Fastify stub — capture the handler registered for POST /upload-preflight.
function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { post } as unknown as Parameters<typeof import('./upload-preflight.js').uploadPreflightRoute>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function postPreflight(opts: { body?: unknown; authHeader?: string }) {
  const { uploadPreflightRoute } = await import('./upload-preflight.js');
  const { app, handlers } = makeApp();
  await uploadPreflightRoute(app, {} as never);
  const { reply, calls } = makeReply();

  const req = {
    headers: { authorization: opts.authHeader ?? 'Bearer test.jwt' },
    body: opts.body,
    log: { warn: vi.fn(), error: vi.fn() },
  };
  await handlers.get('/upload-preflight')!(req, reply);
  return calls;
}

const healthDocBody = {
  filename: 'lab report.pdf',
  mimeType: 'application/pdf',
  size: 12_345,
  category: 'lab_results',
  title: 'March labs',
  description: 'CBC panel',
  documentDate: '2026-03-01',
  studyRegistrationId: 'study-reg-1',
};

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockCreateSignedUploadUrl.mockReset();
  mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });
  mockCreateSignedUploadUrl.mockResolvedValue('https://minio.local/signed-put');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('health-document preflight happy path', () => {
  it('persists the row and returns a MinIO presigned PUT target', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'doc-1', file_path: 'user-1/uuid_lab_report.pdf', file_name: 'lab_report.pdf' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const calls = await postPreflight({ body: healthDocBody });

    expect(calls.status).toBeNull(); // implicit 200
    const body = calls.body as Record<string, unknown>;
    expect(body.documentId).toBe('doc-1');
    expect(body.uploadUrl).toBe('https://minio.local/signed-put');
    expect(body.bucket).toBe('health-documents');
    expect(body.mimeType).toBe('application/pdf');
    expect(body.expiresIn).toBe(7200);
    expect(typeof body.objectKey).toBe('string');
    expect(body.objectKey as string).toMatch(/^user-1\//);
    // No legacy hosted-storage token/path fields.
    expect(body.token).toBeUndefined();

    // ⛔ PODPIS MÍŘÍ DO KARANTÉNY (změna tvrzení 2026-09-21). Do teď se tu žádalo
    // `('health-documents', objectKey)` — tedy PUT rovnou do cílového bucketu, čímž
    // se dokument dostal k uživateli BEZ antivirového skenu a `scanAndPromote` nikdy
    // neběžel. Bajty teď dopadnou do karantény pod klíčem `<cílovýBucket>/<klíč>`
    // a promuje je až `/upload-complete` po čistém verdiktu.
    expect(body.quarantineKey).toBe(`health-documents/${body.objectKey}`);
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith('uploads-quarantine', body.quarantineKey);
    // Řádek v DB drží CÍLOVOU cestu — tam dokument po promoci bude.
    expect(body.bucket).toBe('health-documents');

    // RPC called with the correct owner-derived param names (NO p_user_id).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('http://postgrest:3000/rpc/create_health_document_preflight_audited');
    expect(init.headers.Authorization).toBe('Bearer test.jwt');
    const rpcBody = JSON.parse(init.body);
    expect(rpcBody).not.toHaveProperty('p_user_id');
    expect(rpcBody.p_mime_type).toBe('application/pdf');
    expect(rpcBody.p_file_size).toBe(12_345);
    expect(rpcBody.p_category).toBe('lab_results');
    expect(rpcBody.p_title).toBe('March labs');
    expect(rpcBody.p_study_registration_id).toBe('study-reg-1');
    expect(rpcBody.p_file_path).toBe(body.objectKey);
  });
});

describe('health-document preflight validation', () => {
  it('400 when size is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const calls = await postPreflight({ body: { filename: 'x.pdf', mimeType: 'application/pdf' } });

    expect(calls.status).toBe(400);
    expect((calls.body as { message: string }).message).toMatch(/size/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('415 when the MIME type is not allowed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const calls = await postPreflight({
      body: { filename: 'x.exe', mimeType: 'application/x-msdownload', size: 10 },
    });

    expect(calls.status).toBe(415);
    expect((calls.body as { error: string }).error).toBe('unsupported_type');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 when the RPC denies the upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'denied' }));

    const calls = await postPreflight({ body: healthDocBody });

    expect(calls.status).toBe(403);
    expect((calls.body as { error: string }).error).toBe('access_denied');
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('upload-preflight auth gate', () => {
  it('401 when the token is missing/invalid (verifyToken throws AuthError)', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'Missing bearer token'));
    vi.stubGlobal('fetch', vi.fn());

    const calls = await postPreflight({ authHeader: '', body: healthDocBody });

    expect(calls.status).toBe(401);
    expect((calls.body as { error: string }).error).toBe('Missing bearer token');
  });
});

/**
 * ⛔ VEŘEJNÝ BUCKET = OBSAH VEŘEJNÉHO WEBU (naměřeno 2026-09-21).
 *
 * Privátní bucket chrání RPC (krok 6). Veřejný žádné nemá — a bez role-checku
 * stačilo být PŘIHLÁŠENÝ, aby kdokoli dostal podepsané PUT do `page-assets`
 * nebo `hero-images`. Deklarovaný požadavek „admin nebo staff" v repu existoval,
 * ale jen v SQL politikách nad `storage.objects`, což jsou metadatové stuby —
 * soubory přes ně nechodí, takže se politika nikdy nevyhodnotí.
 */
describe('veřejný bucket vyžaduje roli admin/staff', () => {
  const telo = { bucket: 'hero-images', filename: 'foto.png', contentType: 'image/png', fileSizeBytes: 1024 };

  it('403 pro přihlášeného člena bez role', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });
    vi.stubGlobal('fetch', vi.fn());

    const calls = await postPreflight({ body: telo });

    expect(calls.status).toBe(403);
    expect((calls.body as { error: string }).error).toBe('access_denied');
    expect(mockCreateSignedUploadUrl, 'podpis se nesmí vydat vůbec').not.toHaveBeenCalled();
  });

  it('podepíše PUT pro staff a klíč razí server', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-2', roles: ['staff'], claims: {} });
    vi.stubGlobal('fetch', vi.fn());

    const calls = await postPreflight({ body: telo });

    expect(calls.status).toBeNull();
    const body = calls.body as Record<string, unknown>;
    expect(body.bucket).toBe('hero-images');
    expect(body.objectKey as string).toMatch(/^user-2\/[0-9a-f-]+_foto\.png$/);
    // Podpis do karantény; cílový bucket je PRVNÍ segment klíče, aby promoce věděla,
    // kam objekt patří (splitQuarantineKey na tom trvá).
    expect(body.quarantineKey).toBe(`hero-images/${body.objectKey}`);
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith('uploads-quarantine', body.quarantineKey);
  });

  it('podepíše PUT pro admina', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-3', roles: ['admin'], claims: {} });
    vi.stubGlobal('fetch', vi.fn());

    const calls = await postPreflight({ body: telo });

    expect(calls.status).toBeNull();
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it('400 pro bucket, který není ani veřejný, ani privátní', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-3', roles: ['admin'], claims: {} });
    vi.stubGlobal('fetch', vi.fn());

    const calls = await postPreflight({ body: { ...telo, bucket: 'web-artifact-sources' } });

    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toBe('invalid_bucket');
  });
});
