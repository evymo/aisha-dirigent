/**
 * Tests for applySecurity() — the single wiring wrapper.
 *
 * We boot a real Fastify instance and let `applySecurity` register the actual
 * plugins. Then we hit it with a test client to verify the observable
 * behaviour: helmet headers present, CORS allowlist enforced, rate-limit
 * hits return 429, error handler shape is safe.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { applySecurity } from '../applySecurity.js';

async function buildApp(corsAllowlist: string, max = 100): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await applySecurity(app, {
    service: 'svc-test',
    cors: { allowlist: corsAllowlist },
    rateLimit: { enabled: true, max, timeWindow: 60_000 },
  });
  app.get('/ping', async () => ({ ok: true }));
  app.post('/explode', async () => {
    throw new Error('postgres connection refused at pg.client');
  });
  await app.ready();
  return app;
}

describe('applySecurity() — helmet headers', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp('https://app.example.com');
  });
  afterAll(async () => {
    await app.close();
  });

  test('sets X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('sets X-Frame-Options: DENY', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  test('sets Strict-Transport-Security with maxAge=31536000', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    const hsts = res.headers['strict-transport-security'] as string;
    expect(hsts).toContain('max-age=31536000');
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });

  test('sets Referrer-Policy: no-referrer', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  test('does NOT expose X-Powered-By', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('applySecurity() — CORS enforcement', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp('https://app.example.com');
  });
  afterAll(async () => {
    await app.close();
  });

  test('allows requests from allowlisted origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  test('does not echo origin for non-allowlisted requests', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: { origin: 'https://evil.com', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('never emits "Access-Control-Allow-Origin: *" for credentialed setup', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: { origin: 'https://anything.example.com', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('applySecurity() — error handler', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp('https://app.example.com');
  });
  afterAll(async () => {
    await app.close();
  });

  test('500 errors return sanitised message (no DB internals)', async () => {
    const res = await app.inject({ method: 'POST', url: '/explode' });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string; message: string };
    expect(body.message).toBe('Internal error');
    expect(body.message).not.toContain('postgres');
    expect(body.message).not.toContain('pg.client');
  });

  test('error response body has the public shape { error, message }', async () => {
    const res = await app.inject({ method: 'POST', url: '/explode' });
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
    expect(body).not.toHaveProperty('stack');
  });
});

describe('applySecurity() — skipErrorHandler', () => {
  test('does not register error handler when skipErrorHandler=true', async () => {
    const app = Fastify({ logger: false });
    await applySecurity(app, {
      service: 'svc-test',
      cors: { allowlist: 'https://app.example.com' },
      skipErrorHandler: true,
    });
    // Custom error handler installed by caller
    let customCalled = false;
    app.setErrorHandler((err, _req, reply) => {
      customCalled = true;
      void reply.code(418).send({ teapot: true });
    });
    app.post('/boom', async () => {
      throw new Error('test');
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/boom' });
    expect(customCalled).toBe(true);
    expect(res.statusCode).toBe(418);
    await app.close();
  });
});

describe('applySecurity() — rate limit registration', () => {
  test('emits x-ratelimit headers on every response (plugin is active)', async () => {
    const app = await buildApp('https://app.example.com', 100);
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    // @fastify/rate-limit always adds these when active, regardless of whether
    // the limit was hit. Their presence proves the plugin is wired.
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    await app.close();
  });
});

describe('⭐ applySecurity() — odmítnutí z pluginu zůstane 4xx, ne 500', () => {
  // Hlavička souboru slibovala „rate-limit hits return 429", ale žádný test to
  // neměřil — a výchozí obsluha chyb (toPublicError) každou neznámou chybu,
  // vč. 429 z @fastify/rate-limit, sklápěla na 500. Naměřeno 2026-09-25:
  // 16 služeb s výchozí obsluhou. Volající pak nepozná „zpomal" od „leží".
  test('dotaz nad limit → 429 s retry-after, ne 500', async () => {
    const app = await buildApp('https://app.example.com', 1);
    expect((await app.inject({ method: 'GET', url: '/ping' })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.json().error).toBe('rate_limited');
    await app.close();
  });

  test('neplatné tělo podle schématu → 400, ne 500', async () => {
    const app = Fastify({ logger: false });
    await applySecurity(app, { service: 'svc-test', cors: { allowlist: '' } });
    app.post('/s', { schema: { body: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } } }, async () => ({ ok: true }));
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/s', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
    expect(res.body).not.toMatch(/fastify|FST_/i);
    await app.close();
  });

  test('neznámá chyba handleru zůstává 500 bez úniku', async () => {
    const app = await buildApp('https://app.example.com');
    const res = await app.inject({ method: 'POST', url: '/explode' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('postgres');
    await app.close();
  });
});
