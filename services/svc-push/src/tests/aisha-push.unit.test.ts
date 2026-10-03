/**
 * Unit tests for svc-push aisha-push route — authenticated SSE channel.
 *
 * Covers:
 *   1. Auth-reject: no/invalid token → 401 (never opens the stream).
 *   2. Happy path: valid user JWT → 200 text/event-stream with the initial
 *      `connected` event, plus heartbeat + disconnect cleanup.
 *
 * Auth is mocked at the boundary; the SSE stream is driven through a fake
 * raw request/response (the sibling send-push test uses the same hand-rolled
 * harness — fastify.inject() would hang on a long-lived hijacked stream).
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class FakeAuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const { mockVerifyToken } = vi.hoisted(() => ({ mockVerifyToken: vi.fn() }));

vi.mock('../auth.js', () => ({
  AuthError: FakeAuthError,
  verifyToken: mockVerifyToken,
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const get = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`GET ${p}`, h));
  return {
    app: { get } as unknown as Parameters<typeof import('../routes/aisha-push.js').aishaPushRoute>[0],
    handlers,
  };
}

function makeSseHarness(headers: Record<string, string>) {
  const rawReq = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
  const writes: string[] = [];
  const writeHead = vi.fn();
  const rawRes = { writeHead, write: (c: string) => { writes.push(c); return true; }, end: vi.fn() };
  const statusCalls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    hijack: vi.fn(),
    raw: rawRes,
    status(c: number) { statusCalls.status = c; return reply; },
    send(b: unknown) { statusCalls.body = b; return reply; },
  };
  const req = { headers, raw: rawReq };
  return { req, reply, writes, writeHead, statusCalls, rawReq };
}

async function openStream(harness: ReturnType<typeof makeSseHarness>) {
  const { aishaPushRoute } = await import('../routes/aisha-push.js');
  const { app, handlers } = makeApp();
  await aishaPushRoute(app);
  await handlers.get('GET /aisha-push')!(harness.req, harness.reply);
}

beforeEach(() => {
  mockVerifyToken.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('GET /aisha-push — auth', () => {
  it('401 when token is missing/invalid — stream never opens', async () => {
    mockVerifyToken.mockRejectedValue(new FakeAuthError(401, 'missing bearer'));
    const harness = makeSseHarness({});
    await openStream(harness);

    expect(harness.statusCalls.status).toBe(401);
    expect(harness.reply.hijack).not.toHaveBeenCalled();
    expect(harness.writeHead).not.toHaveBeenCalled();
  });
});

describe('GET /aisha-push — SSE stream', () => {
  it('valid token → 200 text/event-stream with initial connected event', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-42', roles: ['member'], claims: {} });
    const harness = makeSseHarness({ authorization: 'Bearer good', accept: 'text/event-stream' });
    await openStream(harness);

    expect(harness.reply.hijack).toHaveBeenCalledTimes(1);
    expect(harness.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    }));
    const connectedFrame = harness.writes.find((w) => w.startsWith('event: connected'));
    expect(connectedFrame).toBeDefined();
    expect(connectedFrame).toContain('user-42');
  });

  it('emits a heartbeat comment after the interval and stops on client disconnect', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-7', roles: [], claims: {} });
    const harness = makeSseHarness({ authorization: 'Bearer good' });
    await openStream(harness);

    vi.advanceTimersByTime(25_000);
    expect(harness.writes.some((w) => w.startsWith(': ping'))).toBe(true);

    const beforeClose = harness.writes.length;
    harness.rawReq.emit('close');
    vi.advanceTimersByTime(60_000);
    // No further frames after cleanup cleared the heartbeat.
    expect(harness.writes.length).toBe(beforeClose);
  });
});
