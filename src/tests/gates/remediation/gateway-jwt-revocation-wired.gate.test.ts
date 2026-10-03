/**
 * Remediation gate: OBS-01 — gateway JWT revocation must be WIRED, not just packaged.
 *
 * CONTEXT
 *   Phase 12 WP 3.5 shipped the `@aisha/cache-redis` package that exports
 *   `revokeJwt` / `isJwtRevoked` (see src/tests/gates/wp-3-5-jwt-revocation.gate.test.ts).
 *   That gate is STRUCTURAL — it only proves the package EXISTS and exposes the
 *   contract, and explicitly defers the gateway integration to "a follow-up PR
 *   (or operator wires it directly)". The follow-up never landed.
 *
 * DEFECT (KNOWN-RED at HEAD 569c5ffd)
 *   `grep -rn 'isJwtRevoked|revokeJwt|revoke' services/gateway/src` returns
 *   NOTHING. `services/gateway/src/auth/postgrest-jwt.ts` verifies the Keycloak
 *   token and mints a PostgREST JWT but performs NO revocation check, so a
 *   token that has been explicitly revoked is still honored on every request.
 *   There is also no route to revoke a token (POST /auth/v1/revoke).
 *
 * CONTRACT (post-fix GREEN)
 *   Scanning services/gateway/src, both markers MUST be present:
 *     A) the request/translate path references `isJwtRevoked` (a revocation
 *        CHECK) sourced from `@aisha/cache-redis`, and
 *     B) a revoke route exists — an `/auth/v1/revoke` POST handler that calls
 *        `revokeJwt` (also from `@aisha/cache-redis`).
 *
 * This is a PATTERN gate: it walks the whole gateway src tree (excluding test
 * files) rather than asserting on one hardcoded file, so the fix may live in
 * whichever module the author chooses (postgrest-jwt.ts, a new revocation
 * middleware, auth.ts, etc.) and the gate still passes once both markers exist.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const GATEWAY_SRC = path.join(ROOT, 'services/gateway/src');

/** Recursively collect non-test TypeScript source files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    // Skip test / spec files — the wiring must live in SHIPPING source, not tests.
    if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

interface ScannedFile {
  rel: string;
  src: string;
}

const files: ScannedFile[] = collectSourceFiles(GATEWAY_SRC).map((f) => ({
  rel: path.relative(ROOT, f),
  src: fs.readFileSync(f, 'utf8'),
}));

const anyMatch = (re: RegExp): ScannedFile[] => files.filter((f) => re.test(f.src));

describe('OBS-01 — gateway JWT revocation is wired into shipping source', () => {
  it('sanity: gateway src tree is present and scannable', () => {
    expect(fs.existsSync(GATEWAY_SRC), `${GATEWAY_SRC} must exist`).toBe(true);
    expect(files.length, 'expected gateway .ts source files to scan').toBeGreaterThan(0);
  });

  it('MARKER A: the request/translate path performs a revocation CHECK via isJwtRevoked', () => {
    const hits = anyMatch(/\bisJwtRevoked\b/);
    expect(
      hits.length,
      'services/gateway/src must reference isJwtRevoked (revocation check on the ' +
        'request/translate path). None found — a revoked Keycloak token is still ' +
        'honored on every request. Wire isJwtRevoked from @aisha/cache-redis into ' +
        'the auth/postgrest-jwt translate path (or a preHandler middleware).',
    ).toBeGreaterThan(0);
  });

  it('MARKER B: a revoke route (POST /auth/v1/revoke) exists and calls revokeJwt', () => {
    const callsRevokeJwt = anyMatch(/\brevokeJwt\b/);
    expect(
      callsRevokeJwt.length,
      'services/gateway/src must call revokeJwt (from @aisha/cache-redis) to add a ' +
        'token to the revocation set. None found.',
    ).toBeGreaterThan(0);

    // The revoke route must be reachable at /auth/v1/revoke. Routes are registered
    // under an `/auth/v1` prefix (see server.ts + routes/auth.ts), so accept either
    // the full literal path or a prefix-relative POST handler on `/revoke`.
    const routeDeclared = anyMatch(
      /(\/auth\/v1\/revoke)|(\.post\(\s*['"`]\/revoke['"`])/,
    );
    expect(
      routeDeclared.length,
      "services/gateway/src must expose a POST /auth/v1/revoke route (either the " +
        "literal path or a `.post('/revoke', …)` handler under the /auth/v1 prefix). " +
        'None found.',
    ).toBeGreaterThan(0);
  });

  it('CONTRACT: revocation helpers are sourced from @aisha/cache-redis (not a local re-impl)', () => {
    const importsCacheRedis = anyMatch(
      /from\s*['"]@aisha\/cache-redis(\/revocation)?['"]/,
    );
    expect(
      importsCacheRedis.length,
      'The revocation primitives (isJwtRevoked / revokeJwt) must be imported from ' +
        'the shared @aisha/cache-redis package so revocation state is centralized ' +
        '(DB 2 per §-1.12 R2). No @aisha/cache-redis import found in gateway src.',
    ).toBeGreaterThan(0);
  });
});
