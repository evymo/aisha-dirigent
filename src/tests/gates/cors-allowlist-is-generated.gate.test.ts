import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Gate: CORS_ALLOWLIST is GENERATED, and it carries every surface origin.
 *
 * Why this gate exists
 * --------------------
 * Every Fastify service declares `CORS_ALLOWLIST: ${CORS_ALLOWLIST:-}` and hands
 * it to applySecurity(). Nothing ever assigned the variable, so the default won:
 * an empty allowlist, which denies every browser origin.
 *
 * Measured on a production instance 2026-07-30 — svc-ai-chat, after the Keycloak issuer fix let
 * real tokens through:
 *
 *     cors.empty_allowlist   {"service":"svc-ai-chat"}            (boot)
 *     cors.deny              {"origin":"https://extra.<internal-tld>"}
 *
 * The request authenticated, the answer was computed, and the browser threw it
 * away. Two names existed for one concept (ALLOWED_ORIGINS, CORS_ALLOWLIST) and
 * nothing bridged them.
 *
 * Why the EXISTING gates could not catch it
 * -----------------------------------------
 * `env-doctor-contract-coverage` requires that every compose variable WITHOUT a
 * `:-` default be generated. `CORS_ALLOWLIST: ${CORS_ALLOWLIST:-}` has one, so it
 * was exempt — and the exemption is the danger: an empty default silently turns
 * a security control off, which looks identical to "configured to allow nothing".
 * A missing variable fails loudly; a defaulted one fails silently.
 *
 * What is pinned here is the PROPERTY, not the spelling: the value must be
 * derived from the same source as ALLOWED_ORIGINS (so it cannot drift from the
 * surfaces the instance actually provisions), and it must not be a hand-kept
 * list. An instance with no surfaces legitimately gets only the base origins.
 */

const ROOT = process.cwd();
const domainsEnv = fs.readFileSync(path.join(ROOT, 'config/domains.env'), 'utf8');

/** Assignments in an env template, as `NAME` → raw right-hand side. */
function assignments(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] && m[2] !== undefined) out.set(m[1], m[2]);
  }
  return out;
}

describe('CORS_ALLOWLIST is generated, not left to an empty default', () => {
  const vars = assignments(domainsEnv);

  it('is assigned in the env pipeline at all', () => {
    expect(
      vars.has('CORS_ALLOWLIST'),
      'CORS_ALLOWLIST is read by every service compose as ${CORS_ALLOWLIST:-}; ' +
        'without an assignment the default wins and CORS denies every browser origin',
    ).toBe(true);
  });

  it('is DERIVED from the origin list, not a hand-kept copy', () => {
    const rhs = vars.get('CORS_ALLOWLIST') ?? '';
    // Interpolation of the composed list — any literal hostname here would drift
    // from the surfaces the instance provisions, which is the defect being closed.
    expect(rhs).toMatch(/\$\{?ALLOWED_ORIGINS\}?/);
    expect(rhs, 'no literal hostnames belong in this value').not.toMatch(/https?:\/\/[a-z0-9.-]+\./i);
  });

  it('the list it derives from includes the surface origins', () => {
    // ALLOWED_ORIGINS must keep appending SURFACE_ORIGINS — that append is what
    // puts the extranet (a browser origin calling the same API) on the list.
    const allowed = vars.get('ALLOWED_ORIGINS') ?? '';
    expect(allowed).toContain('SURFACE_ORIGINS');
  });

  it('every service that enforces CORS reads the same variable', () => {
    // A service that invented its own name would silently opt out of the fix.
    const composes = fs
      .readdirSync(ROOT)
      .filter((f) => f.startsWith('docker-compose.coolify') && f.endsWith('.yml'));
    const offenders: string[] = [];
    for (const f of composes) {
      const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
      // Any *_ALLOWLIST env key related to CORS must be exactly CORS_ALLOWLIST.
      for (const m of t.matchAll(/^\s*([A-Z0-9_]*CORS[A-Z0-9_]*):/gm)) {
        if (m[1] !== 'CORS_ALLOWLIST') offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders, 'CORS origins must travel under one name').toEqual([]);
  });
});
