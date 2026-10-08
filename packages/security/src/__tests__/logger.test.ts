/**
 * Tests for the A09 logger primitives.
 *
 * Strategy: each test is a behavioural spec, not a verification. We assert the
 * *contract* (a JWT must never appear in output; a 500-char-plus string must
 * be truncated; a circular reference must not crash). Implementation details
 * are deliberately not tested — only observable behaviour.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  redact,
  createSafeLogger,
  setLogSink,
  resetLogSink,
  publicErrorMessage,
  type SafeLogEntry,
} from '../logger.js';

describe('redact() — sensitive keys', () => {
  test.each([
    'token',
    'TOKEN',
    'access_token',
    'refresh-token',
    'authorization',
    'Authorization',
    'api_key',
    'apiKey',
    'private_key',
    'secret',
    'password',
    'session',
    'cookie',
    'jwt',
  ])('redacts key "%s"', (key) => {
    const out = redact({ [key]: 'real-value' }) as Record<string, unknown>;
    expect(out[key]).toBe('[redacted]');
  });

  test('does not redact non-sensitive keys', () => {
    const out = redact({ id: 'abc', count: 42 }) as Record<string, unknown>;
    expect(out.id).toBe('abc');
    expect(out.count).toBe(42);
  });
});

describe('redact() — PII keys', () => {
  test.each(['email', 'phone', 'ssn', 'date_of_birth', 'address', 'first_name', 'diagnosis'])(
    'redacts PII key "%s" when value is string',
    (key) => {
      const out = redact({ [key]: 'sensitive' }) as Record<string, unknown>;
      expect(out[key]).toBe('[pii-redacted]');
    },
  );
});

describe('redact() — PII value patterns in strings', () => {
  test('redacts email in free-form string', () => {
    expect(redact('contact me at alice@example.com please')).toContain('[email-redacted]');
    expect(redact('contact me at alice@example.com please')).not.toContain('alice@example.com');
  });

  test('redacts JWT-shaped tokens in free-form string', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxw1234567890abcdef';
    const out = redact(`error from ${jwt} timed out`) as string;
    expect(out).toContain('[jwt-redacted]');
    expect(out).not.toContain('eyJ');
  });

  test('redacts Bearer tokens regardless of case', () => {
    expect(redact('Authorization: Bearer abc123def')).toContain('Bearer [redacted]');
    expect(redact('Authorization: bearer abc123def')).toContain('Bearer [redacted]');
  });

  test('redacts OpenAI-style api keys', () => {
    expect(redact('using key sk-abcdefghijklmnopqrstuvwxyz123456')).toContain(
      '[api-key-redacted]',
    );
  });
});

describe('redact() — credentials inside URLs', () => {
  test.each([
    ['https://bob:hunter2@api.example.com/v1', ['bob', 'hunter2']],
    // raw `@` inside the password: nothing of it may survive
    ['https://bob:p@ss@w0rd@api.example.com/v1', ['bob', 'p@ss', 'w0rd']],
    ['postgres://svc:Zx9-secret-tail@db.internal:5432/app', ['svc', 'Zx9-secret-tail']],
  ])('userinfo of %s is gone, host and path stay', (url, leaked) => {
    const out = redact(`fetch failed for ${url} after retry`) as string;
    for (const part of leaked) expect(out).not.toContain(part);
    expect(out).toContain('[userinfo-redacted]@');
    expect(out).toMatch(/@(api\.example\.com\/v1|db\.internal:5432\/app) after retry$/);
  });

  test.each([
    'access_token',
    'token',
    'api_key',
    'apikey',
    'key',
    'sig',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'code',
    'client_secret',
    'password',
    'auth',
  ])('value of query param "%s" is redacted', (name) => {
    const out = redact(`GET https://api.example.com/cb?page=2&${name}=Q7-leaky-value&lang=cs`) as string;
    expect(out).not.toContain('Q7-leaky-value');
    expect(out).toContain(`&${name}=[redacted]`);
  });

  test('anchor: harmless params, path and host stay readable', () => {
    const url = 'https://api.example.com/v1/items?page=2&lang=cs&sort=desc#top';
    expect(redact(`calling ${url}`)).toBe(`calling ${url}`);
  });

  test.each([
    // non-word characters in the password: the email pattern alone would keep the user and its head
    ['_https://bobA:pw!A1@h.example.com/', 'bobA'],
    ['_https://bobA:pw!A1@h.example.com/', 'pw!'],
    ['1https://bobB:pw!B2@h.example.com/', 'bobB'],
    ['1https://bobB:pw!B2@h.example.com/', 'pw!'],
    ['see //bobC:pw!C3@h.example.com/x', 'bobC'],
    ['see //bobC:pw!C3@h.example.com/x', 'pw!'],
    ['cb#access_token=TK1&state=ok', 'TK1'],
    ['cb#id_token=TK2', 'TK2'],
    ['x?code_verifier=V1&page=2', 'V1'],
    ['x?pwd=V2&page=2', 'V2'],
    ['x?pass=V3&page=2', 'V3'],
    ['x?passwd=V4&page=2', 'V4'],
    ['x?otp=V5&page=2', 'V5'],
    ['x?redirect_uri=https%3A%2F%2Fadmin%3ApwD4%40host.example.com%2Fp', 'pwD4'],
  ])('no credential survives in %s', (input, secret) => {
    const out = redact(`log ${input}`) as string;
    expect(out).not.toContain(secret);
  });

  test('an authority cut by truncation is dropped, not shown in part', () => {
    const out = redact(`${'x'.repeat(490)} https://user:secretpassXYZ@host.example.com/`) as string;
    expect(out).toContain('[truncated:');
    expect(out).not.toContain('secretpass');
  });

  // Logged strings are attacker-shaped (Origin header → cors.deny, unauthenticated).
  // Inputs that made the earlier patterns quadratic: each must stay cheap.
  test.each([
    [';', ';'.repeat(1_000_000)],
    ['?', '?'.repeat(1_000_000)],
    ['?a', '?a'.repeat(500_000)],
    ['a.', 'a.'.repeat(500_000)],
    ['a-', 'a-'.repeat(500_000)],
    ['//', '//'.repeat(500_000)],
    ['%2F%2F', '%2F%2F'.repeat(200_000)],
    ['a.a@', 'a.a@'.repeat(250_000)],
  ])('redaction stays cheap on a 1 MB %s input', (_name, input) => {
    const start = performance.now();
    redact(input);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  test('applies inside nested log context, not only top-level strings', () => {
    const out = JSON.stringify(redact({ hop: { target: 'https://u:pw-123@h.example.com/?sig=abc123' } }));
    expect(out).not.toContain('pw-123');
    expect(out).not.toContain('abc123');
  });
});

describe('redact() — e-mail pattern is linear, Authorization in text, encoded parameter names', () => {
  test('real addresses are still redacted (local part up to 64)', () => {
    expect(redact('kontakt: jan.novak+test@example.test, díky')).toBe('kontakt: [email-redacted], díky');
    expect(redact(`${'a'.repeat(64)}@example.test`)).toBe('[email-redacted]');
  });

  // Vlastnost, ne mikro-benchmark: neomezená lokální část stála 14 s na 100 kB
  // tvaru `a.a.a…` (každá hranice slova znovu prohledala zbytek vstupu), omezená
  // 29 ms. Strop 2 s má rezervu ~70× i pro zatížený stroj a kvadratiku pořád chytí.
  test('attacker-shaped 100 kB text without @ costs linear time', () => {
    const vstup = 'a.'.repeat(50_000);
    const start = performance.now();
    const out = redact(vstup, { maxStringLength: 100_000 });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(out).toBe(vstup);
  });

  test('Authorization header written as text keeps the scheme, drops the credential', () => {
    expect(redact('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe('Authorization: Basic [redacted]');
    expect(redact('{"authorization":"Digest username=\\"u\\""}')).not.toContain('username');
    expect(redact('proxy-authorization=NTLM TlRMTVNTUAAB')).toBe('proxy-authorization=NTLM [redacted]');
  });

  test('anchor: the word Basic in prose is left alone', () => {
    expect(redact('Basic information about the plan')).toBe('Basic information about the plan');
  });

  test('percent-encoded parameter names are recognised (once or twice encoded)', () => {
    expect(redact('/x?%74oken=abc123&lang=cs')).toBe('/x?%74oken=[redacted]&lang=cs');
    expect(redact('/x?%2574oken=abc123&lang=cs')).toBe('/x?%2574oken=[redacted]&lang=cs');
    expect(redact('/x?%6C%61ng=cs')).toBe('/x?%6C%61ng=cs');
  });
});

describe('redact() — safety guards', () => {
  test('truncates over-long strings', () => {
    const long = 'x'.repeat(2000);
    const out = redact(long) as string;
    expect(out.length).toBeLessThan(700);
    expect(out).toContain('[truncated:');
  });

  test('returns max-depth marker instead of recursing forever', () => {
    let nested: Record<string, unknown> = { v: 'leaf' };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    const out = JSON.stringify(redact(nested));
    expect(out).toContain('[max-depth-reached]');
  });

  test('handles Error objects safely', () => {
    const err = new Error('jwt eyJabc.def.ghi expired');
    const out = redact(err) as { message: string; name: string };
    expect(out.name).toBe('Error');
    expect(out.message).toContain('[jwt-redacted]');
  });

  test('caps array length to prevent log floods', () => {
    const arr = Array.from({ length: 500 }, (_, i) => i);
    const out = redact(arr) as unknown[];
    expect(out.length).toBeLessThanOrEqual(100);
  });

  test('handles null and undefined', () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  test('serialises BigInt', () => {
    expect(redact(123n)).toBe('123');
  });

  test('serialises Date as ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(redact(d)).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('createSafeLogger() — emission', () => {
  let captured: SafeLogEntry[];

  beforeEach(() => {
    captured = [];
    setLogSink((e) => captured.push(e));
  });

  test('safeInfo emits info level with service tag', () => {
    const log = createSafeLogger('svc-test');
    log.safeInfo('boot.complete', { port: 3000 });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      level: 'info',
      service: 'svc-test',
      msg: 'boot.complete',
    });
  });

  test('safeError redacts the err field automatically', () => {
    const log = createSafeLogger('svc-test');
    log.safeError('rpc.failed', new Error('Bearer abc123 invalid'));
    expect(captured[0].level).toBe('error');
    const errDump = JSON.stringify(captured[0].err);
    expect(errDump).not.toContain('abc123');
  });

  test('safeWarn redacts ctx', () => {
    const log = createSafeLogger('svc-test');
    log.safeWarn('jwt.weird', { token: 'eyJraw.token.value' });
    const ctxDump = JSON.stringify(captured[0].ctx);
    expect(ctxDump).not.toContain('eyJraw');
  });

  test('resetLogSink restores stdout sink without throwing', () => {
    resetLogSink();
    expect(() => createSafeLogger('svc-test').safeInfo('ping')).not.toThrow();
  });
});

describe('publicErrorMessage() — client-safe messages', () => {
  test('returns the message for benign errors', () => {
    expect(publicErrorMessage(new Error('Document not found'))).toBe('Document not found');
  });

  test('falls back when the message looks like an internal leak', () => {
    expect(publicErrorMessage(new Error('postgres connection refused at pg.client'))).toBe(
      'Internal error',
    );
    expect(publicErrorMessage(new Error('ECONNREFUSED 127.0.0.1:5432'))).toBe('Internal error');
    expect(publicErrorMessage(new Error('at Object.handler (node_modules/fastify/lib.js:42)'))).toBe(
      'Internal error',
    );
  });

  test('truncates long messages', () => {
    const msg = 'x'.repeat(500);
    expect(publicErrorMessage(new Error(msg)).length).toBeLessThanOrEqual(200);
  });

  test('returns the fallback when err is not an Error', () => {
    expect(publicErrorMessage('weird string thrown')).toBe('Internal error');
    expect(publicErrorMessage(null)).toBe('Internal error');
    expect(publicErrorMessage({ random: 'obj' })).toBe('Internal error');
  });
});
