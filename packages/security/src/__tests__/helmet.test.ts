/**
 * Tests for the A05 helmet options factory.
 *
 * We don't test @fastify/helmet itself — that's upstream's job. We assert
 * that the OPTIONS we produce embody the policy we promise (HSTS on by
 * default, frameguard=deny, CSP disabled for API services).
 */

import { describe, test, expect } from 'vitest';
import { buildHelmetOptions, DEFAULT_PERMISSIONS_POLICY } from '../helmet.js';

describe('buildHelmetOptions() — defaults', () => {
  const opts = buildHelmetOptions();

  test('disables CSP by default (API services)', () => {
    expect(opts.contentSecurityPolicy).toBe(false);
  });

  test('enables HSTS with 1y maxAge + subdomains + preload', () => {
    expect(opts.hsts).toMatchObject({
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    });
  });

  test('frameguard=deny (blocks clickjacking)', () => {
    expect(opts.frameguard).toEqual({ action: 'deny' });
  });

  test('noSniff=true (blocks MIME confusion)', () => {
    expect(opts.noSniff).toBe(true);
  });

  test('referrerPolicy=no-referrer (strips Referer headers)', () => {
    expect(opts.referrerPolicy).toEqual({ policy: 'no-referrer' });
  });

  test('hidePoweredBy=true (no X-Powered-By: Fastify)', () => {
    expect(opts.hidePoweredBy).toBe(true);
  });

  test('crossOriginOpenerPolicy=same-origin (isolates browsing context)', () => {
    expect(opts.crossOriginOpenerPolicy).toEqual({ policy: 'same-origin' });
  });

  test('permittedCrossDomainPolicies=none (blocks Flash/PDF cross-domain)', () => {
    expect(opts.permittedCrossDomainPolicies).toEqual({ permittedPolicies: 'none' });
  });
});

describe('buildHelmetOptions() — overrides', () => {
  test('enableContentSecurityPolicy=true wires default-deny CSP', () => {
    const opts = buildHelmetOptions({ enableContentSecurityPolicy: true });
    expect(opts.contentSecurityPolicy).toMatchObject({ useDefaults: true });
    const directives = (opts.contentSecurityPolicy as { directives: Record<string, string[]> }).directives;
    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.frameAncestors).toEqual(["'none'"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
  });

  test('cspDirectives override applies cleanly', () => {
    const opts = buildHelmetOptions({
      enableContentSecurityPolicy: true,
      cspDirectives: { defaultSrc: ["'self'", 'https://cdn.example.com'] },
    });
    const directives = (opts.contentSecurityPolicy as { directives: Record<string, string[]> }).directives;
    expect(directives.defaultSrc).toEqual(["'self'", 'https://cdn.example.com']);
  });

  test('enableHsts=false drops HSTS (for local dev without TLS)', () => {
    const opts = buildHelmetOptions({ enableHsts: false });
    expect(opts.hsts).toBe(false);
  });
});

describe('DEFAULT_PERMISSIONS_POLICY', () => {
  test('disables every sensitive browser API', () => {
    expect(DEFAULT_PERMISSIONS_POLICY).toContain('camera=()');
    expect(DEFAULT_PERMISSIONS_POLICY).toContain('microphone=()');
    expect(DEFAULT_PERMISSIONS_POLICY).toContain('geolocation=()');
    expect(DEFAULT_PERMISSIONS_POLICY).toContain('payment=()');
    expect(DEFAULT_PERMISSIONS_POLICY).toContain('usb=()');
  });

  test('does not list any API as enabled', () => {
    // No entries of the form `xxx=(self)` or `xxx=*` — every API is locked.
    expect(DEFAULT_PERMISSIONS_POLICY).not.toMatch(/=\s*\*/);
    expect(DEFAULT_PERMISSIONS_POLICY).not.toMatch(/=\s*\(self\)/);
  });
});
