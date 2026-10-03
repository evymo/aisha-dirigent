/**
 * P5-broker-notify-owner — behavioral contract test.
 *
 * The /sandbox/notify broker endpoint must forward the push `user_id` as the
 * VERIFIED broker-token owner (`bp.user_id`), NOT the caller-supplied
 * `body.userId`. Otherwise any sandboxed plugin can push notifications to an
 * arbitrary foreign user by spoofing `userId` in the request body
 * (cross-tenant notification injection).
 *
 * This test signs a broker token whose `user_id` is the real owner, then posts
 * a notify with a DIFFERENT (attacker-chosen) `userId` in the body and asserts
 * the outbound push carries the OWNER id, not the body id.
 *
 * KNOWN-RED at HEAD: broker.ts forwards `user_id: body.userId`.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

// config.ts reads env at import time — set the broker secret before importing
// anything that transitively imports config.
const BROKER_SECRET = 'test-broker-secret-at-least-32-chars-long!!';
process.env.BROKER_TOKEN_SECRET = BROKER_SECRET;
process.env.PUSH_SERVICE_URL = 'http://push.invalid:9999';

const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ATTACKER_TARGET_ID = '22222222-2222-2222-2222-222222222222';

describe('P5 — /sandbox/notify forwards broker-token owner as push user_id', () => {
  let app: import('fastify').FastifyInstance;
  let signedToken: string;
  let capturedPushBody: Record<string, unknown> | null = null;

  beforeAll(async () => {
    const { SignJWT } = await import('jose');
    const secretBytes = new TextEncoder().encode(BROKER_SECRET);
    signedToken = await new SignJWT({
      kind: 'broker',
      source_ref: 'plugin-under-test',
      user_id: OWNER_ID,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('broker-subject')
      .setAudience('aisha-plugin-broker')
      .setExpirationTime('5m')
      .sign(secretBytes);

    // Intercept the outbound push call. Only the push endpoint is mocked;
    // anything else surfaces as an error so the test can't silently pass.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/send')) {
          capturedPushBody = JSON.parse(String(init?.body ?? '{}'));
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected outbound fetch to ${u}`);
      }),
    );

    const Fastify = (await import('fastify')).default;
    const { sandboxBrokerRoutes } = await import('../routes/broker.js');
    app = Fastify();
    await app.register(sandboxBrokerRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });

  it('uses bp.user_id (owner), ignoring the spoofed body.userId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sandbox/notify',
      headers: { authorization: `Bearer ${signedToken}` },
      payload: { userId: ATTACKER_TARGET_ID, title: 'hello', body: 'world' },
    });

    expect(res.statusCode).toBe(204);
    expect(capturedPushBody).not.toBeNull();
    // CORRECT (post-fix) contract: the push targets the verified token owner.
    expect(capturedPushBody?.user_id).toBe(OWNER_ID);
    expect(capturedPushBody?.user_id).not.toBe(ATTACKER_TARGET_ID);
  });
});
