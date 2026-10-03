/**
 * Unit tests for notify.ts — covers every throw branch + the happy
 * "queued" path. The only outbound I/O is `ssrf.safeFetch` (PostgREST RPC),
 * which we stub per case. `config` is read at module import time, so each
 * test sets env + `vi.resetModules()` then imports fresh.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { SsrfGuard } from '@aisha/security';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  level: 'silent',
  child: () => noopLog,
  silent: () => {},
  isLevelEnabled: () => true,
  bindings: () => ({}),
  flush: () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as FastifyBaseLogger;

const safeFetch = vi.fn();
const ssrf = { safeFetch } as unknown as SsrfGuard;

function setConfiguredEnv(): void {
  process.env.POSTGREST_URL = 'http://postgrest:3000';
  process.env.POSTGREST_SERVICE_JWT = 'postgrest-test-jwt';
  process.env.OPENCLAW_OUTBOUND_HOSTS = 'llm-gateway,postgrest';
}

function clearConfigEnv(): void {
  delete process.env.POSTGREST_URL;
  delete process.env.POSTGREST_SERVICE_JWT;
  delete process.env.OPENCLAW_OUTBOUND_HOSTS;
}

/** Imports enqueueNotification with the current process.env baked into config. */
async function loadNotify(): Promise<typeof import('./notify.js').enqueueNotification> {
  vi.resetModules();
  const mod = await import('./notify.js');
  return mod.enqueueNotification;
}

function rpcResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const INPUT = {
  channel: 'matrix' as const,
  recipient: '@operator:aisha.local',
  payload: { text: 'Stack check finished' },
};

beforeEach(() => {
  safeFetch.mockReset();
  setConfiguredEnv();
});

afterEach(() => {
  clearConfigEnv();
});

describe('enqueueNotification — throw branches', () => {
  it('throws postgrest_not_configured when the service JWT is missing (no safeFetch call)', async () => {
    // Clearing the JWT trips the `!config.postgrestServiceJwt` guard even
    // though postgrestUrl has a default.
    delete process.env.POSTGREST_SERVICE_JWT;
    const enqueueNotification = await loadNotify();

    await expect(enqueueNotification(INPUT, noopLog, ssrf)).rejects.toThrow(
      'postgrest_not_configured',
    );
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('throws postgrest_unreachable when safeFetch rejects', async () => {
    safeFetch.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const enqueueNotification = await loadNotify();

    await expect(enqueueNotification(INPUT, noopLog, ssrf)).rejects.toThrow(
      /^postgrest_unreachable: .*ETIMEDOUT/,
    );
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it('throws rpc_failed when PostgREST returns a non-ok status', async () => {
    safeFetch.mockResolvedValueOnce(new Response('permission denied', { status: 403 }));
    const enqueueNotification = await loadNotify();

    await expect(enqueueNotification(INPUT, noopLog, ssrf)).rejects.toThrow(
      'rpc_failed: HTTP 403',
    );
  });

  it('throws rpc_returned_no_id when the RPC row has no id', async () => {
    safeFetch.mockResolvedValueOnce(rpcResponse([{ status: 'queued' }]));
    const enqueueNotification = await loadNotify();

    await expect(enqueueNotification(INPUT, noopLog, ssrf)).rejects.toThrow(
      'rpc_returned_no_id',
    );
  });

  it('throws rpc_returned_no_id when the RPC returns null body', async () => {
    safeFetch.mockResolvedValueOnce(rpcResponse(null));
    const enqueueNotification = await loadNotify();

    await expect(enqueueNotification(INPUT, noopLog, ssrf)).rejects.toThrow(
      'rpc_returned_no_id',
    );
  });
});

describe('enqueueNotification — queued path', () => {
  it('returns queued status from an array response (notification_id)', async () => {
    safeFetch.mockResolvedValueOnce(
      rpcResponse([{ notification_id: '11111111-1111-4111-8111-111111111111', status: 'queued' }]),
    );
    const enqueueNotification = await loadNotify();

    const r = await enqueueNotification(
      { request_id: '00000000-0000-4000-8000-000000000002', ...INPUT, template: 'stack_check' },
      noopLog,
      ssrf,
    );

    expect(r).toEqual({
      request_id: '00000000-0000-4000-8000-000000000002',
      notification_id: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      channel: 'matrix',
    });

    const [url, init] = safeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://postgrest:3000/rpc/aisha_notify_via_openclaw');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer postgrest-test-jwt' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      p_channel: 'matrix',
      p_recipient: '@operator:aisha.local',
      p_payload: { text: 'Stack check finished' },
      p_template: 'stack_check',
    });
  });

  it('accepts a single-object response and falls back to the `id` field', async () => {
    safeFetch.mockResolvedValueOnce(
      rpcResponse({ id: '22222222-2222-4222-8222-222222222222' }),
    );
    const enqueueNotification = await loadNotify();

    const r = await enqueueNotification(INPUT, noopLog, ssrf);

    expect(r.request_id).toBeNull();
    expect(r.notification_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(r.status).toBe('queued');
    expect(r.channel).toBe('matrix');
  });
});
