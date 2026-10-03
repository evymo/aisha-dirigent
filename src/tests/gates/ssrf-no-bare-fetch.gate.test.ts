/**
 * SSRF universal-enforcement gate (OWASP A10) — defense-in-depth Layer 2.
 *
 * The Semgrep rule `aisha-raw-fetch-outside-ssrf-guard` already forbids bare
 * `fetch(` in `services/`, but Semgrep runs diff-aware in CI (only NEW findings
 * block) and needs the Semgrep container. This gate re-asserts the SAME invariant
 * in the ordinary (semgrep-less) test lane, using a ratcheting baseline:
 *
 *   - Every service source file that currently issues a bare `fetch(` is listed in
 *     `ssrf-known-exemptions.ts` with a reason (pre-existing calls to fixed /
 *     operator-configured hosts — not URLs from untrusted LLM/user input).
 *   - The gate FAILS when a service file NOT in that baseline introduces a bare
 *     `fetch(` — forcing new outbound surfaces through `@aisha/security/ssrf`
 *     (`createSsrfGuard().safeFetch()`), which enforces scheme + host allowlist and
 *     post-DNS IP blocking (loopback / link-local / RFC1918 / CGNAT / metadata).
 *   - The gate also FAILS on stale exemptions (a listed file that no longer has a
 *     bare fetch) so the baseline only shrinks, and on any exemption that matches a
 *     FORBIDDEN pattern (deep-research / web-search / SearXNG — genuinely untrusted
 *     URL surfaces that must never be exempted).
 *
 * This mirrors the Odysseus THREAT_MODEL philosophy: every enumerated untrusted
 * network surface must go through the guard. Per the no-workarounds principle you
 * cannot silently add a new un-guarded outbound path.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { SSRF_FETCH_EXEMPTIONS, FORBIDDEN_EXEMPTION_PATTERNS } from './ssrf-known-exemptions';

const ROOT = process.cwd();
const SERVICES_DIR = resolve(ROOT, 'services');

// Directories that never contain first-party service runtime source.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'tests',
  '__tests__',
  'scripts',
]);

/**
 * Remove comments and string/template literals so a `fetch(` appearing inside a
 * comment or a string (e.g. a doc example or an error message) is not counted.
 * MUST stay in sync with the detector used to author `ssrf-known-exemptions.ts`.
 */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line comments (keep http:// intact)
    .replace(/`(?:\\.|[^`\\])*`/g, '``') // template strings
    .replace(/'(?:\\.|[^'\\])*'/g, "''") // single-quoted strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""'); // double-quoted strings
}

// `fetch(` not preceded by a `.` or word char — so `safeFetch(`, `.fetch(` and
// `prefetch(` are NOT matched, only a bare global `fetch(` call.
const BARE_FETCH = /(^|[^.\w])fetch\s*\(/;

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTsFiles(full, acc);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function toRepoRel(abs: string): string {
  return relative(ROOT, abs).split(sep).join('/');
}

function findBareFetchFiles(): string[] {
  return walkTsFiles(SERVICES_DIR)
    .filter((abs) => BARE_FETCH.test(stripNoise(readFileSync(abs, 'utf8'))))
    .map(toRepoRel)
    .sort();
}

describe('SSRF universal enforcement — no bare fetch() outside the guard', () => {
  test('detector recognises a bare fetch and ignores guarded / noise forms', () => {
    // Guard against the scanner silently breaking (which would make the gate
    // vacuously pass). Positive + negative controls for the detector itself.
    expect(BARE_FETCH.test(stripNoise('const r = await fetch(url);'))).toBe(true);
    expect(BARE_FETCH.test(stripNoise('const r = await fetch(`${base}/x`);'))).toBe(true);
    expect(BARE_FETCH.test(stripNoise('await safeFetch(url);'))).toBe(false);
    expect(BARE_FETCH.test(stripNoise('await guard.fetch(url);'))).toBe(false);
    expect(BARE_FETCH.test(stripNoise('// legacy: await fetch(url)'))).toBe(false);
    expect(BARE_FETCH.test(stripNoise('const msg = "call fetch(url) here";'))).toBe(false);
  });

  test('no NEW service file introduces a bare fetch() outside the SSRF guard', () => {
    const offenders = findBareFetchFiles();
    const newViolations = offenders.filter((f) => !(f in SSRF_FETCH_EXEMPTIONS));
    expect(
      newViolations,
      `New bare fetch() detected in service runtime. Route it through ` +
        `@aisha/security/ssrf (createSsrfGuard().safeFetch()) so host allowlist + ` +
        `IP guards apply. If this is a fixed operator-configured host, add it to ` +
        `src/tests/gates/ssrf-known-exemptions.ts with a reason.\n` +
        newViolations.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  test('every exemption still has a bare fetch (no stale rows — baseline only shrinks)', () => {
    const offenders = new Set(findBareFetchFiles());
    const stale = Object.keys(SSRF_FETCH_EXEMPTIONS).filter((f) => !offenders.has(f));
    expect(
      stale,
      `These files are exempted in ssrf-known-exemptions.ts but no longer contain ` +
        `a bare fetch() (migrated or moved). Remove them so the baseline stays honest:\n` +
        stale.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  test('no exemption covers a genuinely untrusted URL surface', () => {
    const forbidden = Object.keys(SSRF_FETCH_EXEMPTIONS).filter((f) =>
      FORBIDDEN_EXEMPTION_PATTERNS.some((re) => re.test(f)),
    );
    expect(
      forbidden,
      `These exemptions match a forbidden pattern (deep-research / web-search / ` +
        `SearXNG). Modules that fetch URLs derived from untrusted input MUST use the ` +
        `SSRF guard and cannot be exempted:\n` + forbidden.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  test('exemption baseline is non-empty and every entry has a reason', () => {
    const entries = Object.entries(SSRF_FETCH_EXEMPTIONS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, reason] of entries) {
      expect(path.startsWith('services/'), `exemption path must be repo-relative: ${path}`).toBe(
        true,
      );
      expect(reason.trim().length, `exemption ${path} must document a reason`).toBeGreaterThan(10);
    }
  });
});
