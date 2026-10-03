/**
 * Unit testy routy `DELETE /object/:bucket/*`.
 *
 * Routa je NOVÁ (2026-09-21) — klient ji volal, server ji neměl (naměřeno přes
 * veřejnou bránu: 404 na `DELETE /storage/v1/object/{bucket}`). Měří se:
 *   (a) 401 bez tokenu,
 *   (b) 403 pro přihlášeného bez role admin/staff,
 *   (c) 404 pro privátní i neznámý bucket (mazání dokumentu je doménová operace
 *       s řádkem v DB, ne operace úložiště),
 *   (d) 204 + skutečné smazání pro admin/staff,
 *   (e) 204 i pro objekt, který už není (DELETE je idempotentní).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockVerifyToken, mockDeleteObject } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockDeleteObject: vi.fn(),
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
vi.mock('../minio.js', () => ({ deleteObject: mockDeleteObject }));
vi.mock('../config.js', () => ({
  config: {
    publicBuckets: new Set(['page-assets', 'hero-images']),
    privateBuckets: new Set(['health-documents']),
  },
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const del = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { delete: del } as unknown as Parameters<typeof import('./object-delete.js').objectDeleteRoute>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function smaz(opts: { bucket: string; key: string; authHeader?: string }) {
  const { objectDeleteRoute } = await import('./object-delete.js');
  const { app, handlers } = makeApp();
  await objectDeleteRoute(app, {} as never);
  const { reply, calls } = makeReply();
  const req = {
    headers: { authorization: opts.authHeader ?? 'Bearer test.jwt' },
    params: { bucket: opts.bucket, '*': opts.key },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  await handlers.get('/object/:bucket/*')!(req, reply);
  return calls;
}

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockDeleteObject.mockReset();
  mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['admin'], claims: {} });
  mockDeleteObject.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('DELETE /object/:bucket/*', () => {
  it('401 bez platného tokenu', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'Missing bearer token'));

    const calls = await smaz({ bucket: 'page-assets', key: 'a.png', authHeader: '' });

    expect(calls.status).toBe(401);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('403 pro člena bez role', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });

    const calls = await smaz({ bucket: 'page-assets', key: 'a.png' });

    expect(calls.status).toBe(403);
    expect((calls.body as { error: string }).error).toBe('access_denied');
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('404 pro privátní bucket — mazání dokumentu vede doména, ne úložiště', async () => {
    const calls = await smaz({ bucket: 'health-documents', key: 'user-1/x.pdf' });

    expect(calls.status).toBe(404);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('404 pro neznámý bucket', async () => {
    const calls = await smaz({ bucket: 'vymysleny', key: 'x' });

    expect(calls.status).toBe(404);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('204 a skutečné smazání pro staff', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-9', roles: ['staff'], claims: {} });

    const calls = await smaz({ bucket: 'page-assets', key: 'user-9/uuid_a.png' });

    expect(calls.status).toBe(204);
    expect(mockDeleteObject).toHaveBeenCalledWith('page-assets', 'user-9/uuid_a.png');
  });

  it('204 i když objekt už není (idempotentní DELETE)', async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error('nope'), { code: 'NoSuchKey' }));

    const calls = await smaz({ bucket: 'page-assets', key: 'a.png' });

    expect(calls.status).toBe(204);
  });

  it('502 když úložiště neodpoví', async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error('econn'), { code: 'ECONNREFUSED' }));

    const calls = await smaz({ bucket: 'page-assets', key: 'a.png' });

    expect(calls.status).toBe(502);
    expect((calls.body as { error: string }).error).toBe('storage_unavailable');
  });
});
