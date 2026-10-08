/**
 * safeLoggerOptions — behaviour of a real Fastify logger built by the factory.
 *
 * Every assertion reads what the logger actually WROTE (a captured stream), not
 * what a function returned: the leak this guards against happened in the
 * framework's own request logging, which no unit of ours calls directly.
 *
 * Each secret has a harmless neighbour (anchor) that must survive — a
 * serializer that blanked the whole URL would pass the "no secret" half and
 * still be wrong.
 */

import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import {
  redactLogArguments,
  redactUrlForLog,
  safeErrSerializer,
  safeLoggerOptions,
  safeReqSerializer,
  safeResSerializer,
  urlHostForLog,
} from '../logOptions.js';

// JWT-shaped test value (header {"alg":"HS256"}, payload {"sub":"u"}); not a real credential.
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.dGVzdC1zaWduYXR1cmU';
const OPAQUE = 'opaque-test-value-7f3a';

function captureStream(): { stream: Writable; lines: () => Record<string, unknown>[]; raw: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const raw = (): string => chunks.join('');
  const lines = (): Record<string, unknown>[] =>
    raw()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { stream, lines, raw };
}

async function appWithCapturedLog() {
  const cap = captureStream();
  const app = Fastify({ logger: safeLoggerOptions({ level: 'info', stream: cap.stream }) });
  app.get('/ws', async () => ({ ok: true }));
  app.get('/boom', async () => {
    const err = new Error(`upstream refused token ${JWT}`) as Error & { code: string; config: unknown };
    err.code = 'E_UPSTREAM';
    err.config = { headers: { authorization: `Bearer ${JWT}` } };
    throw err;
  });
  await app.ready();
  return { app, ...cap };
}

describe('Fastify request logging through safeLoggerOptions', () => {
  test('incoming request: token gone from url, path and harmless parameter stay', async () => {
    const { app, lines, raw } = await appWithCapturedLog();
    await app.inject({ method: 'GET', url: `/ws?token=${JWT}&lang=cs` });
    await app.close();

    expect(raw()).not.toContain(JWT);
    const incoming = lines().find((l) => l.msg === 'incoming request');
    expect(incoming, 'Fastify logs every request — the line must exist').toBeDefined();
    const req = incoming!.req as Record<string, unknown>;
    expect(req.url).toMatch(/^\/ws\?token=/);
    expect(req.url).toContain('lang=cs');
    expect(req.method).toBe('GET');
  });

  test('opaque token in a sensitive parameter is redacted too, not only JWT-shaped values', async () => {
    const { app, raw } = await appWithCapturedLog();
    await app.inject({ method: 'GET', url: `/ws?access_token=${OPAQUE}&topic=news` });
    await app.close();
    expect(raw()).not.toContain(OPAQUE);
    expect(raw()).toContain('topic=news');
  });

  test('authorization and cookie headers never reach the request log', async () => {
    const { app, raw } = await appWithCapturedLog();
    await app.inject({
      method: 'GET',
      url: '/ws',
      headers: { authorization: `Bearer ${OPAQUE}`, cookie: `sid=${OPAQUE}` },
    });
    await app.close();
    expect(raw()).not.toContain(OPAQUE);
    expect(raw()).not.toMatch(/authorization|cookie/i);
  });

  test('404 message (Fastify writes the raw URL into the message) is redacted', async () => {
    const { app, lines, raw } = await appWithCapturedLog();
    await app.inject({ method: 'GET', url: `/ws/?token=${JWT}&lang=cs` });
    await app.close();
    expect(raw()).not.toContain(JWT);
    const notFound = lines().find((l) => typeof l.msg === 'string' && l.msg.includes('not found'));
    expect(notFound, 'the 404 line must still be written').toBeDefined();
    expect(notFound!.msg).toContain('lang=cs');
  });

  test('error path: message redacted, code kept, nested client config dropped', async () => {
    const { app, lines, raw } = await appWithCapturedLog();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    expect(res.statusCode).toBe(500);
    expect(raw()).not.toContain(JWT);
    const errLine = lines().find((l) => l.err !== undefined);
    expect(errLine).toBeDefined();
    const err = errLine!.err as Record<string, unknown>;
    expect(err.code).toBe('E_UPSTREAM');
    expect(err.type).toBe('Error');
    expect(err.message).toContain('upstream refused token');
    expect(err).not.toHaveProperty('config');
  });
});

// Měřené případy z revize 3295a1085: pole objektu mimo klíče req/err serializer
// ani hook dřív neviděly.
describe('objects outside req/err: key by key, any depth', () => {
  const T3 = 'test-opaque-T3-a91f';
  const T4 = 'test-opaque-T4-5c2e';
  const T5 = 'test-opaque-T5-77d0';

  async function app() {
    const cap = captureStream();
    const a = Fastify({ logger: safeLoggerOptions({ level: 'info', stream: cap.stream }) });
    a.get('/ctx', async (req) => {
      req.log.info({ ctx: { url: `/x?token=${T3}&lang=cs` } }, 'ctx');
      return {};
    });
    a.get('/headers', async (req) => {
      req.log.info({ headers: req.headers }, 'hdr');
      return {};
    });
    a.get('/error', async (req) => {
      const e = new Error('upstream 401') as Error & { code: string; config: unknown };
      e.code = 'ERR_BAD_REQUEST';
      e.config = { headers: { Authorization: `Bearer ${T3}` }, url: `https://api.example.test/v1?api_key=${T4}` };
      req.log.error({ error: e, attempt: 2 }, 'upstream failed');
      return {};
    });
    a.get('/harmless', async (req) => {
      req.log.info({ userId: 'u-1', count: 3, path: '/x?lang=cs', nested: { ok: true, list: [1, 2] } }, 'harmless');
      return {};
    });
    a.get('/interpolated', async (req) => {
      req.log.info('interpolated %o', { token: T5, k: 'v' });
      return {};
    });
    await a.ready();
    return { a, ...cap };
  }

  test('{ ctx: { url } } — token inside a nested string is redacted, the rest of the URL stays', async () => {
    const { a, raw, lines } = await app();
    await a.inject({ method: 'GET', url: '/ctx' });
    await a.close();
    expect(raw()).not.toContain(T3);
    const line = lines().find((l) => l.msg === 'ctx') as { ctx: { url: string } };
    expect(line.ctx.url).toBe('/x?token=[redacted]&lang=cs');
  });

  test('{ headers: req.headers } — authorization and cookie redacted, harmless header stays', async () => {
    const { a, raw, lines } = await app();
    await a.inject({
      method: 'GET',
      url: '/headers',
      headers: { authorization: `Bearer ${T3}`, cookie: `sid=${T4}`, 'x-trace-id': 'trace-1' },
    });
    await a.close();
    expect(raw()).not.toContain(T3);
    expect(raw()).not.toContain(T4);
    const line = lines().find((l) => l.msg === 'hdr') as { headers: Record<string, unknown> };
    expect(line.headers['x-trace-id']).toBe('trace-1');
  });

  test('Error under key "error" — config with Authorization is gone, code kept', async () => {
    const { a, raw, lines } = await app();
    await a.inject({ method: 'GET', url: '/error' });
    await a.close();
    expect(raw()).not.toContain(T3);
    expect(raw()).not.toContain(T4);
    const line = lines().find((l) => l.msg === 'upstream failed') as { error: Record<string, unknown>; attempt: number };
    expect(line.error).toMatchObject({ type: 'Error', message: 'upstream 401', code: 'ERR_BAD_REQUEST' });
    expect(line.error).not.toHaveProperty('config');
    expect(line.attempt).toBe(2);
  });

  test('anchor: a harmless object is logged unchanged', async () => {
    const { a, lines } = await app();
    await a.inject({ method: 'GET', url: '/harmless' });
    await a.close();
    const line = lines().find((l) => l.msg === 'harmless');
    expect(line).toMatchObject({ userId: 'u-1', count: 3, path: '/x?lang=cs', nested: { ok: true, list: [1, 2] } });
  });

  test('an object among interpolation values (%o) is redacted too', async () => {
    const { a, raw } = await app();
    await a.inject({ method: 'GET', url: '/interpolated' });
    await a.close();
    expect(raw()).not.toContain(T5);
    expect(raw()).toContain('interpolated');
  });

  test('root bindings (base) are redacted; harmless binding stays', async () => {
    const cap = captureStream();
    const a = Fastify({
      logger: safeLoggerOptions({ level: 'info', stream: cap.stream, base: { token: T4, tenant: 'acme' } }),
    });
    a.get('/', async (req) => {
      req.log.info('base line');
      return {};
    });
    await a.inject({ method: 'GET', url: '/' });
    await a.close();
    expect(cap.raw()).not.toContain(T4);
    expect(cap.lines().find((l) => l.msg === 'base line')).toMatchObject({ tenant: 'acme' });
  });

  // Hranice, kterou továrna sama zavřít neumí: pino formatter vazeb pro každé
  // dítě resetuje a vazby dítěte zapíše mimo hook. Proto brána bere `.child(`
  // ve službách jako nález. Test drží, že tvrzení v dokumentaci odpovídá stavu.
  test('limit: child bindings bypass options — documented, held by the gate', async () => {
    const cap = captureStream();
    const a = Fastify({ logger: safeLoggerOptions({ level: 'info', stream: cap.stream }) });
    a.get('/', async (req) => {
      req.log.child({ token: T4 }).info('child line');
      return {};
    });
    await a.inject({ method: 'GET', url: '/' });
    await a.close();
    expect(cap.raw()).toContain(T4);
  });
});

describe('safeLoggerOptions — fail-closed on options that would undo it', () => {
  test.each([
    ['serializers.req', { serializers: { req: (r: unknown) => r } }],
    ['serializers.err', { serializers: { err: (e: unknown) => e } }],
    ['serializers.res', { serializers: { res: (r: unknown) => r } }],
    ['formatters.bindings', { formatters: { bindings: (b: object) => b } }],
    ['hooks.logMethod', { hooks: { logMethod() {} } }],
    ['messageKey', { messageKey: 'message' }],
    ['errorKey', { errorKey: 'error' }],
  ])('%s is refused', (_name, extra) => {
    expect(() => safeLoggerOptions({ level: 'info', ...extra })).toThrow(/safeLoggerOptions/);
  });

  test('other options pass through; an extra serializer keeps working, its output redacted (anchor)', () => {
    const extra = (v: unknown) => v;
    const opts = safeLoggerOptions({ level: 'warn', serializers: { user: extra } });
    expect(opts.level).toBe('warn');
    const user = opts.serializers?.user as (v: unknown) => unknown;
    expect(user({ id: 'u-1', plan: 'basic' })).toEqual({ id: 'u-1', plan: 'basic' });
    expect(JSON.stringify(user({ id: 'u-1', apiKey: OPAQUE }))).not.toContain(OPAQUE);
    expect(opts.serializers?.req).toBe(safeReqSerializer);
    expect(opts.serializers?.res).toBe(safeResSerializer);
    expect(opts.serializers?.err).toBe(safeErrSerializer);
    expect(typeof opts.hooks?.logMethod).toBe('function');
    expect(typeof opts.formatters?.bindings).toBe('function');
  });

  test('a non-function serializer is refused, not dropped', () => {
    expect(() => safeLoggerOptions({ level: 'info', serializers: { user: 'x' as never } })).toThrow(/not a function/);
  });
});

describe('serializers and helpers', () => {
  test('request serializer keeps Fastify fields and never emits headers', () => {
    const out = safeReqSerializer({
      method: 'GET',
      url: `/ws?token=${JWT}`,
      headers: { authorization: `Bearer ${OPAQUE}`, 'accept-version': '2' },
      host: 'svc.example.test',
      ip: '10.0.0.7',
      socket: { remotePort: 4242 },
    });
    expect(JSON.stringify(out)).not.toContain(JWT);
    expect(JSON.stringify(out)).not.toContain(OPAQUE);
    expect(out).toMatchObject({ method: 'GET', version: '2', host: 'svc.example.test', remoteAddress: '10.0.0.7', remotePort: 4242 });
    expect(out).not.toHaveProperty('headers');
  });

  test('error serializer follows cause and redacts non-Error values', () => {
    const inner = new Error(`inner ${JWT}`);
    const outer = new Error('outer', { cause: inner });
    const out = safeErrSerializer(outer) as { cause: { message: string } };
    expect(out.cause.message).toMatch(/^inner /);
    expect(JSON.stringify(out)).not.toContain(JWT);
    expect(JSON.stringify(safeErrSerializer({ token: OPAQUE, reason: 'x' }))).not.toContain(OPAQUE);
  });

  test('log arguments: strings redacted, message taken from a bare error is redacted', () => {
    const [msg] = redactLogArguments([`calling https://user:${OPAQUE}@host.example.test/x?lang=cs`]);
    expect(msg).not.toContain(OPAQUE);
    expect(msg).toContain('host.example.test/x?lang=cs');

    const fromErr = redactLogArguments([new Error(`token ${JWT}`)]);
    expect(fromErr).toHaveLength(2);
    expect(fromErr[1]).not.toContain(JWT);

    const withMsg = redactLogArguments([{ err: new Error('x') }, 'own message']);
    expect(withMsg).toEqual([expect.anything(), 'own message']);
  });

  test('redactUrlForLog keeps shape; urlHostForLog never echoes an unparsable value', () => {
    expect(redactUrlForLog(`/rest/v1/rpc/f?apikey=${OPAQUE}&select=id`)).toBe('/rest/v1/rpc/f?apikey=[redacted]&select=id');
    expect(urlHostForLog(`https://user:${OPAQUE}@hooks.example.test/path/${OPAQUE}`)).toBe('hooks.example.test');
    const bad = urlHostForLog(`not a url ${OPAQUE}`);
    expect(bad).not.toContain(OPAQUE);
    expect(bad).toMatch(/^\[invalid-url length=\d+\]$/);
  });
});
