import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import {
  createServiceRpc,
  createUserRpc,
  createNullableServiceRpc,
  createUserClaimsRpc,
  buildPostgrestClaims,
  mintPostgrestJwt,
  PostgRESTError,
  rpc,
  updateRow,
  insertRow,
} from '../index.js';

const URL = 'http://pg.test:3000';
const TOKEN = 'service-token-xyz';
const SECRET = 'unit-test-secret-0123456789';

function jsonResponse(body: unknown, init: { status?: number; contentType?: string } = {}): Response {
  const { status = 200, contentType = 'application/json' } = init;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'Content-Type': contentType } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.POSTGREST_URL = URL;
  process.env.POSTGREST_SERVICE_TOKEN = TOKEN;
  process.env.JWT_SECRET = SECRET;
  delete process.env.POSTGREST_JWT_SECRET;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createServiceRpc', () => {
  it('POSTs to /rpc/<fn> with the service bearer token and returns parsed JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const rpcService = createServiceRpc();
    const out = await rpcService<{ ok: number }>('do_thing', { a: 1 });

    expect(out).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL}/rpc/do_thing`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it('defaults params to {} and includes Accept by default, omits Prefer by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await createServiceRpc()('no_args');
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body)).toEqual({});
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers.Prefer).toBeUndefined();
  });

  it('accept:false omits the Accept header; preferRepresentation:true adds Prefer', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
    await createServiceRpc({ accept: false })('minimal');
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBeUndefined();

    await createServiceRpc({ preferRepresentation: true })('repr');
    expect(fetchMock.mock.calls[1][1].headers.Prefer).toBe('return=representation');
  });

  it('throws PostgRESTError carrying status + body on a non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('boom', { status: 500, contentType: 'text/plain' }));
    const rpcService = createServiceRpc();
    await expect(rpcService('fail')).rejects.toBeInstanceOf(PostgRESTError);
    fetchMock.mockResolvedValueOnce(jsonResponse('nope', { status: 403, contentType: 'text/plain' }));
    await expect(rpcService('fail').catch((e) => e)).resolves.toMatchObject({ status: 403 });
  });

  it('reads POSTGREST_URL / token at CALL time (not module load)', async () => {
    process.env.POSTGREST_URL = 'http://other:3000';
    process.env.POSTGREST_SERVICE_TOKEN = 'rotated';
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await createServiceRpc()('x');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://other:3000/rpc/x');
    expect(init.headers.Authorization).toBe('Bearer rotated');
  });
});

describe('createUserRpc', () => {
  it('uses the caller-supplied JWT as the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ me: true }));
    const rpcUser = createUserRpc({ accept: true, preferRepresentation: true });
    await rpcUser('whoami', {}, 'user-jwt-abc');
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer user-jwt-abc');
    expect(init.headers.Prefer).toBe('return=representation');
  });
});

describe('timeout / abort', () => {
  it('aborts the request after timeoutMs', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const rpcService = createServiceRpc({ timeoutMs: 5_000 });
    const p = rpcService('slow').catch((e) => (e as Error).message);
    expect(capturedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toBe('aborted');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('no timeout + no caller signal ⇒ fetch receives no signal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await createServiceRpc()('x'); // no timeoutMs
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });

  it('a caller budget signal aborts the request', async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('caller-aborted')));
      }),
    );
    const p = createServiceRpc()('x', {}, { signal: ctrl.signal }).catch((e) => (e as Error).message);
    ctrl.abort();
    await expect(p).resolves.toBe('caller-aborted');
  });
});

describe('createNullableServiceRpc', () => {
  it('returns parsed JSON on a JSON 2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ v: 2 }));
    const r = await createNullableServiceRpc()('f');
    expect(r).toEqual({ v: 2 });
  });

  it('returns null when the 2xx body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    const r = await createNullableServiceRpc()('void_fn');
    expect(r).toBeNull();
  });
});

describe('claims → minted JWT', () => {
  it('buildPostgrestClaims sets role=authenticated and unions realm roles', () => {
    const claims = buildPostgrestClaims({
      sub: 'u1',
      preferred_username: 'alice',
      realm_access: { roles: ['admin'] },
      roles: ['user'],
    } as never);
    expect(claims.role).toBe('authenticated');
    expect(claims.email).toBe('alice');
    expect(new Set(claims.roles as string[])).toEqual(new Set(['user', 'admin']));
  });

  it('mintPostgrestJwt throws when no secret is configured', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.POSTGREST_JWT_SECRET;
    await expect(mintPostgrestJwt({ sub: 'u' } as never)).rejects.toThrow('postgrest_jwt_secret_not_configured');
  });

  it('createUserClaimsRpc mints a valid HS256 JWT and forwards it as the bearer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const rpcUserClaims = createUserClaimsRpc({ accept: true, preferRepresentation: true });
    await rpcUserClaims('secured', { x: 1 }, { sub: 'u42' } as never);
    const forwarded = fetchMock.mock.calls[0][1].headers.Authorization.replace('Bearer ', '');
    // Token is a well-formed 3-part JWT signed with the configured secret.
    const [h, pl] = forwarded.split('.');
    expect(h && pl).toBeTruthy();
    const payload = JSON.parse(Buffer.from(pl, 'base64url').toString());
    expect(payload.sub).toBe('u42');
    expect(payload.role).toBe('authenticated');
  });
});

describe('table helpers (reflection runtime)', () => {
  it('rpc parses JSON, falls back to raw text, and null on empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    expect(await rpc('a')).toBe('not json');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    expect(await rpc('b')).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    expect(await rpc('c')).toEqual({ ok: 1 });
  });

  it('rpc throws PostgRESTError with parsed body on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'denied' }, { status: 401 }));
    const err = await rpc('x').catch((e) => e);
    expect(err).toBeInstanceOf(PostgRESTError);
    expect(err.status).toBe(401);
    expect(err.body).toEqual({ message: 'denied' });
  });

  it('updateRow PATCHes /<table>?col=eq.val with return=minimal', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await updateRow('agent_runs', { id: 'r1' }, { status: 'done' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL}/agent_runs?id=eq.r1`);
    expect(init.method).toBe('PATCH');
    expect(init.headers.Prefer).toBe('return=minimal');
  });

  it('insertRow POSTs /<table> with return=representation and returns the first row', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'new1' }]));
    const row = await insertRow('agent_runs', { status: 'queued' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL}/agent_runs`);
    expect(init.headers.Prefer).toBe('return=representation');
    expect(row).toEqual({ id: 'new1' });
  });
});
