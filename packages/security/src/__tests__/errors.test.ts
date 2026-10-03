/**
 * Tests for the A03/A05 error and validation primitives.
 *
 * The contract: a service handler must be able to throw a typed error and
 * trust that `toPublicError` collapses it to a safe shape. Anything that
 * leaks a stack frame, a postgres error code, or an internal hostname is a
 * regression.
 */

import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import {
  toPublicError,
  pluginRejection,
  validateBody,
  ValidationError,
  NotAuthorizedError,
  NotFoundError,
  ConflictError,
} from '../errors.js';

describe('toPublicError() — status code mapping', () => {
  test('ValidationError → 400 with fields', () => {
    const err = new ValidationError([{ path: 'email', message: 'must be a valid email' }]);
    const result = toPublicError(err);
    expect(result.statusCode).toBe(400);
    expect(result.body.error).toBe('validation_error');
    expect(result.body.fields).toEqual([{ path: 'email', message: 'must be a valid email' }]);
  });

  test('NotAuthorizedError → 403', () => {
    expect(toPublicError(new NotAuthorizedError()).statusCode).toBe(403);
  });

  test('NotFoundError → 404', () => {
    expect(toPublicError(new NotFoundError()).statusCode).toBe(404);
  });

  test('ConflictError → 409', () => {
    expect(toPublicError(new ConflictError('document already exists')).statusCode).toBe(409);
  });

  test('unknown error → 500 with sanitised message', () => {
    const result = toPublicError(new Error('postgres connection refused at pg.client'));
    expect(result.statusCode).toBe(500);
    expect(result.body.message).toBe('Internal error');
    expect(result.body.error).toBe('internal');
  });
});

describe('toPublicError() — leak prevention', () => {
  test('strips Node stack frames', () => {
    const err = new Error('at Object.handler (/app/node_modules/fastify/lib/router.js:42:10)');
    const result = toPublicError(err);
    expect(result.body.message).not.toContain('node_modules');
    expect(result.body.message).not.toContain('fastify');
  });

  test('strips ECONNREFUSED / ETIMEDOUT', () => {
    const err = new Error('ECONNREFUSED 127.0.0.1:5432');
    expect(toPublicError(err).body.message).toBe('Internal error');
  });

  test('strips postgres / postgrest leakage', () => {
    expect(toPublicError(new Error('postgrest 401')).body.message).toBe('Internal error');
    expect(toPublicError(new Error('pg: relation does not exist')).body.message).toBe(
      'Internal error',
    );
  });
});

describe('validateBody() — happy path', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().int().min(0),
  });

  test('returns typed payload on valid body', () => {
    const parsed = validateBody(schema, { email: 'alice@example.com', age: 30 });
    expect(parsed).toMatchObject({ email: 'alice@example.com', age: 30 });
  });

  test('z.object is permissive by default — unknown keys pass through', () => {
    // Documents the actual zod behaviour rather than asserting strict —
    // services that want strict input should declare schemas with .strict().
    const parsed = validateBody(schema, {
      email: 'alice@example.com',
      age: 30,
      extra: 'noise',
    }) as Record<string, unknown>;
    expect(parsed.email).toBe('alice@example.com');
  });

  test('strict schemas reject unknown keys', () => {
    const strict = schema.strict();
    expect(() =>
      validateBody(strict, { email: 'alice@example.com', age: 30, extra: 'noise' }),
    ).toThrow(ValidationError);
  });
});

describe('validateBody() — adversarial inputs', () => {
  const schema = z.object({
    name: z.string().max(50),
    role: z.enum(['user', 'admin']),
  });

  test('rejects missing required field with field-level error', () => {
    try {
      validateBody(schema, { role: 'user' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const v = err as ValidationError;
      expect(v.fields).toEqual([
        expect.objectContaining({ path: 'name' }),
      ]);
    }
  });

  test('rejects enum violation', () => {
    expect(() => validateBody(schema, { name: 'a', role: 'superadmin' })).toThrow(ValidationError);
  });

  test('rejects type confusion', () => {
    expect(() => validateBody(schema, { name: 12345, role: 'user' })).toThrow(ValidationError);
  });

  test('rejects prototype pollution attempts', () => {
    const polluted = JSON.parse('{"name": "ok", "role": "user", "__proto__": {"polluted": true}}');
    // Validation should succeed (schema doesn't reference __proto__) — but the
    // returned object must NOT have a polluted prototype. This is JSON.parse's
    // job; we just verify the resulting object is well-formed.
    const parsed = validateBody(schema, polluted) as Record<string, unknown>;
    expect((parsed as { polluted?: boolean }).polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test('rejects deeply nested junk', () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i < 1000; i++) nested = { wrap: nested };
    expect(() => validateBody(schema, nested as unknown)).toThrow(ValidationError);
  });
});

describe('⭐ pluginRejection() — odmítnutí s kódem 4xx od NAŠEHO serveru je odpověď volajícímu', () => {
  test('429 z našeho limitu dotazů (prostý objekt se značkou původu)', () => {
    const limit = { statusCode: 429, code: 'AISHA_RATE_LIMITED', error: 'Too Many Requests', message: 'Rate limit exceeded. Retry after 1 minute.' };
    expect(pluginRejection(limit)).toEqual({ statusCode: 429, body: { error: 'rate_limited', message: 'Rate limit exceeded. Retry after 1 minute.' } });
    expect(toPublicError(limit).statusCode).toBe(429);
  });

  test('chyba jádra Fastify (FST_*) — validace 400, velké tělo 413', () => {
    expect(pluginRejection(Object.assign(new Error("body must have required property 'a'"), { statusCode: 400, code: 'FST_ERR_VALIDATION' }))?.statusCode).toBe(400);
    expect(pluginRejection(Object.assign(new Error('Request body is too large'), { statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE' }))?.body.error).toBe('payload_too_large');
  });

  test('zpráva 4xx projde sanitizérem — interní podrobnost neunikne', () => {
    const r = pluginRejection(Object.assign(new Error('ECONNREFUSED 127.0.0.1:5432'), { statusCode: 400, code: 'FST_ERR_VALIDATION' }));
    expect(r?.body.message).toBe('Request rejected');
  });

  test('⭐ 4xx od UPSTREAMU (cizí API) se NEPROPUSTÍ — volajícímu by lhalo, že selhal on', () => {
    // web-push nese statusCode od push služby, LlmCompletionError od LLM upstreamu
    const webPush = Object.assign(new Error('Received unexpected response code'), { statusCode: 429, name: 'WebPushError' });
    const llm = Object.assign(new Error('upstream 401 invalid api key'), { statusCode: 401 });
    expect(pluginRejection(webPush)).toBeNull();
    expect(pluginRejection(llm)).toBeNull();
    expect(pluginRejection({ statusCode: 429, message: 'bez značky' })).toBeNull();
    expect(toPublicError(llm).statusCode).toBe(500);
  });

  test('sonda umí říct NE: 5xx, chybějící nebo nečíselný kód → null (a toPublicError → 500)', () => {
    expect(pluginRejection(Object.assign(new Error('x'), { statusCode: 503, code: 'FST_ERR_X' }))).toBeNull();
    expect(pluginRejection(new Error('x'))).toBeNull();
    expect(pluginRejection({ statusCode: '429', code: 'AISHA_RATE_LIMITED' })).toBeNull();
    expect(pluginRejection(null)).toBeNull();
    expect(toPublicError(Object.assign(new Error('x'), { statusCode: 503 })).statusCode).toBe(500);
  });
});
