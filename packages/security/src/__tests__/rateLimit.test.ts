/**
 * Tests for the A04 rate-limit primitives.
 *
 * Tier choices are policy decisions encoded in the code. The tests document
 * those decisions and fail loudly if someone bumps them silently — a
 * relaxed auth tier from 5/min to 50/min would silently disable
 * credential-stuffing protection.
 */

import { describe, test, expect } from 'vitest';
import {
  RATE_LIMIT_TIERS,
  routeRateLimit,
  keyByUserOrIp,
  buildGlobalRateLimitOptions,
} from '../rateLimit.js';

describe('RATE_LIMIT_TIERS — policy values', () => {
  test('auth tier is restrictive (≤5/min) with ban (credential stuffing)', () => {
    expect(RATE_LIMIT_TIERS.auth.max).toBeLessThanOrEqual(5);
    expect(RATE_LIMIT_TIERS.auth.timeWindow).toBeLessThanOrEqual(60_000);
    expect(RATE_LIMIT_TIERS.auth.ban).toBeGreaterThan(0);
  });

  test('expensive tier is bounded (≤10/min) — protects cost budget', () => {
    expect(RATE_LIMIT_TIERS.expensive.max).toBeLessThanOrEqual(10);
  });

  test('mutation tier is moderate (≤30/min)', () => {
    expect(RATE_LIMIT_TIERS.mutation.max).toBeLessThanOrEqual(30);
  });

  test('public tier is generous but bounded (≤60/min)', () => {
    expect(RATE_LIMIT_TIERS.public.max).toBeLessThanOrEqual(60);
  });

  test('device-download tier serves an LTE fleet behind one address, but stays bounded', () => {
    // 2026-09-28: tablets behind the operator's CGNAT hit the global 100/min mid-download.
    expect(RATE_LIMIT_TIERS['device-download'].max).toBeGreaterThanOrEqual(600);
    expect(RATE_LIMIT_TIERS['device-download'].max).toBeLessThanOrEqual(1200);
    expect(RATE_LIMIT_TIERS['device-download'].timeWindow).toBe(60_000);
  });

  test('health tier permits monitoring frequency (>=600/min)', () => {
    expect(RATE_LIMIT_TIERS.health.max).toBeGreaterThanOrEqual(600);
  });
});

describe('routeRateLimit()', () => {
  test('wraps tier config in Fastify-compatible shape', () => {
    const cfg = routeRateLimit('auth');
    expect(cfg.rateLimit).toEqual(RATE_LIMIT_TIERS.auth);
  });

  test.each(['auth', 'mutation', 'expensive', 'public', 'health'] as const)(
    'every tier produces a config (%s)',
    (tier) => {
      const cfg = routeRateLimit(tier);
      expect(cfg.rateLimit.max).toBeGreaterThan(0);
      expect(cfg.rateLimit.timeWindow).toBeGreaterThan(0);
    },
  );
});

describe('keyByUserOrIp()', () => {
  test('returns u:<sub> when user is authenticated', () => {
    const req = { user: { sub: 'user-abc' }, ip: '1.2.3.4' } as never;
    expect(keyByUserOrIp(req)).toBe('u:user-abc');
  });

  test('falls back to ip when no user', () => {
    const req = { ip: '1.2.3.4' } as never;
    expect(keyByUserOrIp(req)).toBe('ip:1.2.3.4');
  });

  test('does not return the IP when user is present (prevents NAT bypass)', () => {
    const req = { user: { sub: 'user-abc' }, ip: '1.2.3.4' } as never;
    expect(keyByUserOrIp(req)).not.toContain('1.2.3.4');
  });
});

describe('buildGlobalRateLimitOptions()', () => {
  test('returns enabled options by default', () => {
    const opts = buildGlobalRateLimitOptions();
    expect(opts.global).toBe(true);
    expect(opts.max).toBe(100);
    expect(opts.timeWindow).toBe(60_000);
  });

  test('honours enabled=false (test/dev opt-out)', () => {
    const opts = buildGlobalRateLimitOptions({ enabled: false });
    expect(opts.global).toBe(false);
  });

  test('adds Retry-After + X-RateLimit-* headers', () => {
    const opts = buildGlobalRateLimitOptions();
    const headers = opts.addHeaders as Record<string, boolean>;
    expect(headers['retry-after']).toBe(true);
    expect(headers['x-ratelimit-limit']).toBe(true);
    expect(headers['x-ratelimit-remaining']).toBe(true);
  });

  test('uses keyByUserOrIp as default keyGenerator', () => {
    const opts = buildGlobalRateLimitOptions();
    expect(opts.keyGenerator).toBe(keyByUserOrIp);
  });

  test('errorResponseBuilder produces 429 with safe message', () => {
    const opts = buildGlobalRateLimitOptions();
    const builder = opts.errorResponseBuilder as (
      req: unknown,
      ctx: { after: string; max: number },
    ) => { statusCode: number; error: string; message: string };
    const body = builder({}, { after: '30s', max: 100 });
    expect(body.statusCode).toBe(429);
    expect(body.message).toContain('30s');
    expect(body.message).not.toContain('user');
    expect(body.message).not.toContain('ip');
  });
});
