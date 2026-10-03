/**
 * Unit tests for storage-auth download route (`POST /download`).
 *
 * Focus: the health-document download response must ALSO carry the field names the
 * web client validates against (downloadSchema = { signedUrl, expiresInSeconds? } in
 * src/hooks/useTrackingDocuments.ts) while keeping the legacy { downloadUrl, expiresIn,
 * accessType } fields for back-compat.
 *
 * auth, MinIO, and the PostgREST authorization RPC (global fetch) are mocked at the
 * module boundary so the test runs fully offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockVerifyToken, mockCreateSignedDownloadUrl } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockCreateSignedDownloadUrl: vi.fn(),
}));

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
}));

vi.mock('../minio.js', () => ({
  createSignedDownloadUrl: mockCreateSignedDownloadUrl,
}));

vi.mock('../config.js', () => ({
  config: {
    postgrestUrl: 'http://postgrest:3000',
    downloadUrlTtlSeconds: 300,
    privateBuckets: new Set(['health-documents', 'wearable-analysis']),
  },
}));

// Fastify stub — capture the handler registered for POST /download.
function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { post } as unknown as Parameters<typeof import('./download.js').downloadRoute>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function postDownload(opts: { body?: unknown; authHeader?: string }) {
  const { downloadRoute } = await import('./download.js');
  const { app, handlers } = makeApp();
  await downloadRoute(app, {} as never);
  const { reply, calls } = makeReply();

  const req = {
    headers: { authorization: opts.authHeader ?? 'Bearer test.jwt' },
    body: opts.body,
    log: { warn: vi.fn(), error: vi.fn() },
  };
  await handlers.get('/download')!(req, reply);
  return calls;
}

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockCreateSignedDownloadUrl.mockReset();
  mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });
  mockCreateSignedDownloadUrl.mockResolvedValue('https://minio.local/signed-get');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('health-document download response reconcile', () => {
  it('includes signedUrl + expiresInSeconds (client schema) plus back-compat fields', async () => {
    // get_health_document_download_info_audited RETURNS TABLE(id, file_path, user_id),
    // so PostgREST serializes it as a JSON ARRAY — the route must read the first row.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'doc-uuid-1', file_path: 'user-1/doc.pdf', user_id: 'user-1' }],
      }),
    );

    const calls = await postDownload({ body: { documentId: 'doc-uuid-1' } });

    expect(calls.status).toBeNull(); // implicit 200
    const body = calls.body as Record<string, unknown>;
    // Fields the web client's downloadSchema validates against.
    expect(body.signedUrl).toBe('https://minio.local/signed-get');
    expect(body.expiresInSeconds).toBe(300);
    // Back-compat fields preserved.
    expect(body.downloadUrl).toBe('https://minio.local/signed-get');
    expect(body.expiresIn).toBe(300);
    expect(mockCreateSignedDownloadUrl).toHaveBeenCalledWith('health-documents', 'user-1/doc.pdf');
  });

  it('404 (anti-enumeration) when the authorization RPC denies access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'denied' }),
    );

    const calls = await postDownload({ body: { documentId: 'doc-uuid-1' } });

    expect(calls.status).toBe(404);
    expect((calls.body as { error: string }).error).toBe('not_found');
  });
});

describe('download auth gate', () => {
  it('401 when the token is missing/invalid (verifyToken throws AuthError)', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'Missing bearer token'));

    const calls = await postDownload({ authHeader: '', body: { documentId: 'doc-uuid-1' } });

    expect(calls.status).toBe(401);
    expect((calls.body as { error: string }).error).toBe('Missing bearer token');
  });
});
