/**
 * Unit tests for the svc-matrix USER-facing client-ops proxy.
 *
 * Locks in that each action maps request → Synapse CS-API call → the exact
 * response shape the web/mobile hooks parse (useMatrixMessages), plus
 * auth-reject and unknown-action-reject.
 *
 * Boundaries mocked: verifyToken (KC JWT), resolveMatrixIdentity (KC→Matrix
 * token exchange), and global fetch (the Synapse CS API).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockVerifyToken, mockResolveIdentity } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockResolveIdentity: vi.fn(),
}));

class MockMatrixIdentityError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'MatrixIdentityError';
  }
}

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
}));

vi.mock('../matrix-identity.js', () => ({
  resolveMatrixIdentity: mockResolveIdentity,
  MatrixIdentityError: MockMatrixIdentityError,
}));

vi.mock('../config.js', () => ({
  config: { synapseAdminUrl: 'http://synapse:8008', ssrfHostAllowlist: '' },
}));

// The SSRF guard is infra (unit-tested in packages/security); here safeFetch just
// delegates to the mocked global fetch so we can assert the CS-API request/response.
vi.mock('@aisha/security', () => ({
  createSsrfGuard: () => ({
    safeFetch: (url: string, init?: RequestInit) => fetch(url, init),
  }),
  parseHostAllowlist: () => [],
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

const MATRIX_TOKEN = 'mx-cs-access-token';

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) =>
    handlers.set(`POST ${p}`, h),
  );
  return { app: { post } as unknown as FastifyInstance, handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function callClientOps(body: unknown, opts: { authHeader?: string } = {}) {
  const { clientOpsRoutes } = await import('./client-ops.js');
  const { app, handlers } = makeApp();
  await clientOpsRoutes(app);
  const { reply, calls } = makeReply();
  const handler = handlers.get('POST /client-ops')!;
  await handler(
    { headers: { authorization: opts.authHeader ?? 'Bearer kc-user-jwt' }, body },
    reply,
  );
  return calls;
}

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

beforeEach(() => {
  mockVerifyToken.mockReset().mockResolvedValue({ userId: 'user-1', roles: [], claims: {} });
  mockResolveIdentity.mockReset().mockResolvedValue({
    accessToken: MATRIX_TOKEN,
    matrixUserId: '@user_1:aisha.guru',
    homeServer: 'aisha.guru',
  });
  vi.unstubAllGlobals();
});

describe('client-ops — get_messages', () => {
  it('maps GET /messages chunk → { messages, end } (client contract shape)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        chunk: [
          {
            type: 'm.room.message',
            event_id: '$e1',
            sender: '@a:aisha.guru',
            content: { msgtype: 'm.text', body: 'hello' },
            origin_server_ts: 1700,
          },
          // state event must be filtered out — not a renderable message
          { type: 'm.room.member', event_id: '$s1', sender: '@a:aisha.guru', content: {} },
        ],
        end: 't99_0_0',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const calls = await callClientOps({ action: 'get_messages', room_id: '!room:aisha.guru', limit: 25 });

    // request: correct CS-API URL + user token
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://synapse:8008/_matrix/client/v3/rooms/!room%3Aaisha.guru/messages?dir=b&limit=25',
    );
    expect((init as RequestInit).method).toBe('GET');
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(`Bearer ${MATRIX_TOKEN}`);

    // response: only the message event, shaped for the hook schema
    expect(calls.status).toBeNull();
    expect(calls.body).toEqual({
      messages: [
        {
          event_id: '$e1',
          sender: '@a:aisha.guru',
          content: { msgtype: 'm.text', body: 'hello' },
          origin_server_ts: 1700,
          type: 'm.room.message',
        },
      ],
      end: 't99_0_0',
    });
  });

  it('defaults limit to 50 when omitted and clamps huge values to 100', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ chunk: [], end: 'e' }));
    vi.stubGlobal('fetch', fetchMock);

    await callClientOps({ action: 'get_messages', room_id: '!r:x' });
    expect(fetchMock.mock.calls[0][0]).toContain('limit=50');

    await callClientOps({ action: 'get_messages', room_id: '!r:x', limit: 9999 });
    expect(fetchMock.mock.calls[1][0]).toContain('limit=100');
  });

  it('400 when room_id missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const calls = await callClientOps({ action: 'get_messages' });
    expect(calls.status).toBe(400);
  });
});

describe('client-ops — send_message', () => {
  it('PUTs to /send/m.room.message/{txnId} and returns { event_id }', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ event_id: '$sent1' }));
    vi.stubGlobal('fetch', fetchMock);

    const calls = await callClientOps({
      action: 'send_message',
      room_id: '!room:aisha.guru',
      content: { msgtype: 'm.text', body: 'hi there' },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(
      /^http:\/\/synapse:8008\/_matrix\/client\/v3\/rooms\/!room%3Aaisha\.guru\/send\/m\.room\.message\/[0-9a-f-]+$/,
    );
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ msgtype: 'm.text', body: 'hi there' });
    expect(calls.body).toEqual({ event_id: '$sent1' });
  });

  it('400 when content.body missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const calls = await callClientOps({ action: 'send_message', room_id: '!r:x', content: { msgtype: 'm.text' } });
    expect(calls.status).toBe(400);
  });
});

describe('client-ops — create_room', () => {
  it('POSTs /createRoom and returns { room_id, room_alias? }', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ room_id: '!new:aisha.guru', room_alias: '#story:aisha.guru' }));
    vi.stubGlobal('fetch', fetchMock);

    const calls = await callClientOps({
      action: 'create_room',
      name: 'Story: X',
      topic: 'discussion',
      is_direct: false,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://synapse:8008/_matrix/client/v3/createRoom');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Story: X',
      topic: 'discussion',
      is_direct: false,
    });
    expect(calls.body).toEqual({ room_id: '!new:aisha.guru', room_alias: '#story:aisha.guru' });
  });
});

describe('client-ops — invite', () => {
  it('POSTs /invite and returns { success: true }', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const calls = await callClientOps({
      action: 'invite',
      room_id: '!room:aisha.guru',
      user_id: '@bob:aisha.guru',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://synapse:8008/_matrix/client/v3/rooms/!room%3Aaisha.guru/invite');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ user_id: '@bob:aisha.guru' });
    expect(calls.body).toEqual({ success: true });
  });

  it('502 when Synapse rejects the invite (no membership/power)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ errcode: 'M_FORBIDDEN' }, false, 403)));
    const calls = await callClientOps({ action: 'invite', room_id: '!r:x', user_id: '@b:x' });
    expect(calls.status).toBe(502);
  });
});

describe('client-ops — auth + validation rejects', () => {
  it('propagates auth failure (unauthenticated) — never reaches Synapse', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockVerifyToken.mockRejectedValueOnce(new Error('unauthorized'));

    await expect(
      callClientOps({ action: 'get_messages', room_id: '!r:x' }, { authHeader: undefined }),
    ).rejects.toThrow();
    expect(mockResolveIdentity).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 on unknown action — no Synapse call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = await callClientOps({ action: 'delete_universe', room_id: '!r:x' });
    expect(calls.status).toBe(400);
    expect(calls.body).toEqual({ error: 'Unknown action: delete_universe' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 when action missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const calls = await callClientOps({ room_id: '!r:x' });
    expect(calls.status).toBe(400);
  });
});
