/**
 * Tests for the A09 audit emitter.
 *
 * Key contract: the emitter must NEVER throw — auditing is fire-and-forget.
 * A PostgREST outage cannot block a chat completion. We verify this by
 * making the underlying fetch fail in various ways and asserting the
 * service-layer code path keeps running.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPostgrestAuditEmitter,
  createInMemoryAuditEmitter,
  noopAuditEmitter,
} from '../audit.js';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPostgrestAuditEmitter()', () => {
  test('POSTs to /rpc/log_security_event by default', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await emitter.emit({
      service: 'svc-ai-chat',
      action: 'chat.completion',
      outcome: 'allow',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://postgrest:3000/rpc/log_security_event');
    expect(init.method).toBe('POST');
  });

  test('honours rpcName override', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
      rpcName: 'log_integration_action',
    });
    await emitter.emit({ service: 'svc-x', action: 'a', outcome: 'allow' });
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rpc/log_integration_action');
  });

  test('redacts PII in metadata before transport', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await emitter.emit({
      service: 'svc-x',
      action: 'a',
      outcome: 'allow',
      metadata: { email: 'alice@example.com', token: 'eyJraw' },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init.body as string;
    expect(body).not.toContain('alice@example.com');
    expect(body).not.toContain('eyJraw');
    expect(body).toContain('[pii-redacted]');
  });

  test('sends Bearer service token in Authorization header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await emitter.emit({ service: 'svc-x', action: 'a', outcome: 'allow' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe('Bearer tok-abc-1234567890');
  });

  test('does not throw when PostgREST returns 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await expect(
      emitter.emit({ service: 'svc-x', action: 'a', outcome: 'allow' }),
    ).resolves.toBeUndefined();
  });

  test('does not throw when fetch rejects (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await expect(
      emitter.emit({ service: 'svc-x', action: 'a', outcome: 'allow' }),
    ).resolves.toBeUndefined();
  });

  test('does not throw when emitter receives undefined metadata', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await expect(
      emitter.emit({ service: 'svc-x', action: 'a', outcome: 'deny', reason: 'forbidden' }),
    ).resolves.toBeUndefined();
  });

  test('emits actor_id when provided', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const emitter = createPostgrestAuditEmitter({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'tok-abc-1234567890',
    });
    await emitter.emit({
      service: 'svc-x',
      action: 'a',
      outcome: 'allow',
      actorId: 'user-123',
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain('"p_actor_id":"user-123"');
  });
});

describe('createInMemoryAuditEmitter()', () => {
  test('captures emitted events for assertion in tests', async () => {
    const emitter = createInMemoryAuditEmitter();
    await emitter.emit({ service: 'svc-x', action: 'a', outcome: 'allow' });
    await emitter.emit({ service: 'svc-x', action: 'b', outcome: 'deny', reason: 'no consent' });
    expect(emitter.events).toHaveLength(2);
    expect(emitter.events[1]).toMatchObject({ action: 'b', outcome: 'deny' });
  });
});

describe('noopAuditEmitter', () => {
  test('does not throw and does not call fetch', async () => {
    await noopAuditEmitter.emit({ service: 'x', action: 'a', outcome: 'allow' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
