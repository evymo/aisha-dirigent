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
