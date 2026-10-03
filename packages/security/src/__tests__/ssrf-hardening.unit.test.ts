/**
 * SEC-01 — SSRF hardening (TEST-FIRST remediation spec).
 *
 * Two concrete defects in `../ssrf.ts` that this test pins down:
 *
 *   1. IPv4-mapped IPv6 bypass. `isBlockedIp()` short-circuits on any address
 *      containing ':' into the IPv6 branch and returns `false` for
 *      `::ffff:127.0.0.1`, `::ffff:169.254.169.254`, `::ffff:10.0.0.1`, etc.
 *      These are IPv4 loopback / cloud-metadata / RFC1918 targets wearing an
 *      IPv6 costume — a resolver (or an attacker-controlled DNS answer) that
 *      returns a v4-mapped address walks straight through the IP guard.
 *      Contract: they MUST be blocked (reason: 'ip').
 *
 *   2. Transparent redirect following. `safeFetch()` validates the *initial*
 *      URL then calls `fetch()` with the platform default `redirect: 'follow'`.
 *      A 3xx `Location: http://169.254.169.254/…` is then followed with NO
 *      re-validation — the guard is bypassed on the second hop. Contract:
 *      `safeFetch` must not transparently follow cross-host redirects into
 *      unvalidated territory; it must set `redirect` to 'manual' or 'error'
 *      (and re-check any followed hop).
 *
 * `isBlockedIp` is module-private, so we exercise it through the public
 * `check()` / `safeFetch()` API with a mocked DNS resolver (offline, no
 * network), exactly like the sibling ssrf.test.ts.
 *
 * Run: npm --prefix packages/security test -- src/__tests__/ssrf-hardening.unit.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSsrfGuard, SsrfBlockedError } from '../ssrf.js';

const fetchSpy = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';
const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  fetchSpy.mockReset();
  mockedLookup.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseOpts = { service: 'svc-test', hostAllowlist: ['api.example.com'] };

describe('SEC-01 — IPv4-mapped IPv6 must be blocked (loopback / metadata / RFC1918)', () => {
  // Each of these is an internal IPv4 target expressed as an IPv4-mapped IPv6
  // address. All MUST be rejected with reason 'ip'.
  test.each([
    '::ffff:127.0.0.1', // loopback
    '::ffff:169.254.169.254', // cloud metadata / link-local
    '::ffff:10.0.0.1', // RFC1918
    '::ffff:192.168.1.1', // RFC1918
    '::ffff:172.16.0.1', // RFC1918
    '::ffff:100.64.0.1', // CGNAT / RFC6598
    // Uppercase / mixed-case hex form of the same mapped address.
    '::FFFF:127.0.0.1',
    // Dotless / hex-tail form some resolvers emit for mapped loopback.
    '::ffff:7f00:1',
  ])('rejects IPv4-mapped IPv6 %s', async (ip) => {
    mockedLookup.mockResolvedValueOnce({ address: ip, family: 6 });
    const guard = createSsrfGuard(baseOpts);
    await expect(guard.check('https://api.example.com/x')).rejects.toMatchObject({ reason: 'ip' });
  });

  test('still blocks mapped loopback even when allowInternalNetworks=true', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '::ffff:127.0.0.1', family: 6 });
    const guard = createSsrfGuard({ ...baseOpts, allowInternalNetworks: true });
    await expect(guard.check('https://api.example.com/x')).rejects.toMatchObject({ reason: 'ip' });
  });

  test('still blocks mapped metadata even when allowInternalNetworks=true', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '::ffff:169.254.169.254', family: 6 });
    const guard = createSsrfGuard({ ...baseOpts, allowInternalNetworks: true });
    await expect(guard.check('https://api.example.com/x')).rejects.toMatchObject({ reason: 'ip' });
  });
});

describe('SEC-01 — safeFetch must not transparently follow redirects to internal hosts', () => {
  test('safeFetch pins redirect handling to manual/error (behavioral)', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 });
    fetchSpy.mockResolvedValueOnce(new Response('ok'));
    const guard = createSsrfGuard(baseOpts);
    await guard.safeFetch('https://api.example.com/v1');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // Contract: the guard controls redirect handling instead of inheriting the
    // platform default 'follow', so a 3xx to an internal host can never be
    // followed without a fresh SSRF check.
    expect(init.redirect === 'manual' || init.redirect === 'error').toBe(true);
  });

  test('caller-supplied redirect:follow does not silently defeat the guard', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 });
    fetchSpy.mockResolvedValueOnce(new Response('ok'));
    const guard = createSsrfGuard(baseOpts);
    await guard.safeFetch('https://api.example.com/v1', { redirect: 'follow' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).not.toBe('follow');
  });

  test('source: safeFetch sets an explicit non-follow redirect mode', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ssrf.ts'), 'utf8');
    expect(/redirect:\s*['"](manual|error)['"]/.test(src)).toBe(true);
  });
});

// Sanity guard: the type is still exported so the reason discriminant is real.
test('SsrfBlockedError carries a reason discriminant', () => {
  const e = new SsrfBlockedError('x', 'ip');
  expect(e.reason).toBe('ip');
});
