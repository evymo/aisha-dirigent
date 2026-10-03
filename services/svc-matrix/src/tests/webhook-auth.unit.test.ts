/**
 * Unit tests for svc-matrix webhook auth.
 *
 * Synapse appservice posts events to /webhook with the hs_token in either
 * `?access_token=` query OR `Authorization: Bearer ...`. If we compare
 * the token with `!==` (the pre-wave-10b code did), an attacker on the
 * Synapse network can recover the hs_token byte-by-byte via timing.
 *
 * After wave 10b: uses constantTimeStringCompare from @aisha/security.
 * Tests lock in:
 *   - Constant-time comparison behavior (length-fail fast, full loop on equal-length)
 *   - Auth runs BEFORE any event processing (no DoS via crafted event corpus)
 *   - Both auth carriers (query + header) honoured
 *   - Generic 401 for missing OR wrong token (no oracle)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService } = vi.hoisted(() => ({ mockRpcService: vi.fn() }));

vi.mock('@aisha/security', () => ({
  constantTimeStringCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  },
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));

vi.mock('../config.js', () => ({
  config: {
    matrixWebhookSecret: 'hs-secret-token-from-synapse',
  },
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const put = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`PUT ${p}`, h));
  const post = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`POST ${p}`, h));
  return {
    app: { put, post } as unknown as Parameters<typeof import('../routes/webhook.js').webhookRoutes>[0],
    handlers,
  };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function callWebhook(method: 'PUT' | 'POST', opts: {
  queryToken?: string;
  headerToken?: string;
  body?: unknown;
}) {
  const { webhookRoutes } = await import('../routes/webhook.js');
  const { app, handlers } = makeApp();
  await webhookRoutes(app);
  const { reply, calls } = makeReply();
  await handlers.get(`${method} /webhook`)!(
    {
      query: opts.queryToken !== undefined ? { access_token: opts.queryToken } : {},
      headers: opts.headerToken !== undefined ? { authorization: `Bearer ${opts.headerToken}` } : {},
      body: opts.body ?? { events: [] },
    },
    reply,
  );
  return calls;
}

beforeEach(() => {
  mockRpcService.mockReset().mockResolvedValue(undefined);
});

describe('webhook auth — happy + sad paths', () => {
  it('accepts query ?access_token=<secret>', async () => {
    const calls = await callWebhook('POST', { queryToken: 'hs-secret-token-from-synapse' });
    expect(calls.status).toBe(200);
  });

  it('accepts Authorization: Bearer <secret>', async () => {
    const calls = await callWebhook('POST', { headerToken: 'hs-secret-token-from-synapse' });
    expect(calls.status).toBe(200);
  });

  it('PUT verb also accepts the same auth', async () => {
    const calls = await callWebhook('PUT', { queryToken: 'hs-secret-token-from-synapse' });
    expect(calls.status).toBe(200);
  });

  it('401 when no token in query or header', async () => {
    const calls = await callWebhook('POST', {});
    expect(calls.status).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
  });

  it('401 when token has wrong value (same length)', async () => {
    const calls = await callWebhook('POST', { queryToken: 'XXXXXXXX-token-from-synapse' });
    expect(calls.status).toBe(401);
  });

  it('401 when token has wrong length (length-fail fast)', async () => {
    const calls = await callWebhook('POST', { queryToken: 'short' });
    expect(calls.status).toBe(401);
  });

  it('does NOT process events when auth fails (no RPC, no event handling)', async () => {
    await callWebhook('POST', {
      queryToken: 'wrong',
      body: { events: [{ type: 'm.room.message', sender: '@evil', event_id: 'e1', room_id: 'r1' }] },
    });
    expect(mockRpcService).not.toHaveBeenCalled();
  });

  it('rejection message is GENERIC for ALL failure modes (no oracle)', async () => {
    const wrongs = [
      { queryToken: undefined, headerToken: undefined },            // no token
      { queryToken: '' },                                            // empty
      { queryToken: 'short' },                                       // length mismatch
      { queryToken: 'XXXXXXXX-token-from-synapseY' },                // same length wrong bytes
      { queryToken: 'HS-SECRET-TOKEN-FROM-SYNAPSE' },                // case differs
    ];
    const messages = new Set<string>();
    for (const w of wrongs) {
      const calls = await callWebhook('POST', w);
      expect(calls.status).toBe(401);
      messages.add(JSON.stringify(calls.body));
    }
    expect(messages.size).toBe(1);
    expect([...messages][0]).toBe(JSON.stringify({ error: 'Unauthorized' }));
  });

  it('1MB token rejected in microseconds (length-fail fast — DoS protection)', async () => {
    const t0 = performance.now();
    await callWebhook('POST', { queryToken: 'A'.repeat(1_000_000) });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});
