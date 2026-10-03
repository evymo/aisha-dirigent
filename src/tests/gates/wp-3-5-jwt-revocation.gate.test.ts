/**
 * Gate test: Phase 12 WP 3.5 — JWT revocation cache structural invariants.
 *
 * Enforces:
 *   1. packages/cache-redis/ workspace package exists with @aisha/cache-redis name
 *   2. Exports `./client` (createNamespacedRedis) + `./revocation` (revokeJwt, isJwtRevoked)
 *   3. Uses ioredis (industry standard, not redis-py / node-redis fork)
 *   4. Documents DB-index allocation (DB 2 for JWT revocation per §-1.12 R2)
 *   5. Uses fail-open semantics (null Redis → no mass user lockout)
 *   6. Honors AISHA_SHARED_REDIS_DISABLED env (rollback)
 *   7. TTL capped at 86400 sec (defense against far-future exp)
 *
 * This gate is STRUCTURAL — verifies the package exists and exposes the
 * correct contract. Integration with gateway middleware ships in a
 * follow-up PR (or operator wires it directly).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const PKG_PATH = path.join(ROOT, 'packages/cache-redis');
const PKG_JSON = path.join(PKG_PATH, 'package.json');
const CLIENT_TS = path.join(PKG_PATH, 'src/client.ts');
const REVOCATION_TS = path.join(PKG_PATH, 'src/revocation.ts');
const INDEX_TS = path.join(PKG_PATH, 'src/index.ts');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 3.5 — @aisha/cache-redis package', () => {
  it('package.json exists with @aisha/cache-redis name', () => {
    expect(fs.existsSync(PKG_JSON)).toBe(true);
    const pkg = JSON.parse(readOrEmpty(PKG_JSON)) as {
      name: string;
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('@aisha/cache-redis');
    expect(pkg.exports['.']).toBeDefined();
    expect(pkg.exports['./client']).toBeDefined();
    expect(pkg.exports['./revocation']).toBeDefined();
  });

  it('uses ioredis (industry standard)', () => {
    const pkg = JSON.parse(readOrEmpty(PKG_JSON)) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['ioredis']).toBeDefined();
  });

  it('declares zod for env config validation', () => {
    const pkg = JSON.parse(readOrEmpty(PKG_JSON)) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['zod']).toBeDefined();
  });

  it('is marked private-publishable (publishConfig present, registry env-driven — NOT hardcoded)', () => {
    const pkg = JSON.parse(readOrEmpty(PKG_JSON)) as {
      publishConfig?: { registry?: string; access?: string };
    };
    // publishConfig is the publishability MARKER (aisha-packages-publish reads
    // it + publishes with --registry=$VERDACCIO_URL). The registry host must
    // NOT be hardcoded here (2026-06-10 de-hardcoding); access:restricted stays.
    expect(pkg.publishConfig, 'publishConfig marker present').toBeDefined();
    expect(pkg.publishConfig?.access).toBe('restricted');
    expect(
      pkg.publishConfig?.registry,
      'publishConfig.registry must NOT hardcode a host — comes from VERDACCIO_URL at publish time',
    ).toBeUndefined();
  });
});

describe('Phase 12 WP 3.5 — client.ts', () => {
  it('exports createNamespacedRedis + readRedisConfig', () => {
    const src = readOrEmpty(CLIENT_TS);
    expect(src).toMatch(/export\s+function\s+createNamespacedRedis/);
    expect(src).toMatch(/export\s+function\s+readRedisConfig/);
  });

  it('documents DB-index allocation (0=Langfuse, 1=cache, 2=JWT, 3=IDE)', () => {
    const src = readOrEmpty(CLIENT_TS);
    expect(src).toMatch(/DB\s*0/);
    expect(src).toMatch(/DB\s*1/);
    expect(src).toMatch(/DB\s*2/);
    expect(src).toMatch(/DB\s*3/);
    expect(src).toMatch(/JWT\s+revocation/i);
  });

  it('default Redis URL points at aisha-shared-redis (per §-1.12 R2)', () => {
    expect(readOrEmpty(CLIENT_TS)).toMatch(
      /redis:\/\/aisha-shared-redis:6379/,
    );
  });

  it('honors AISHA_SHARED_REDIS_DISABLED env (rollback path)', () => {
    expect(readOrEmpty(CLIENT_TS)).toMatch(/AISHA_SHARED_REDIS_DISABLED/);
  });

  it('validates DB index range (0-15)', () => {
    const src = readOrEmpty(CLIENT_TS);
    expect(src).toMatch(/0\s*-\s*15/);
    expect(src).toMatch(/Invalid Redis DB index/);
  });

  it('uses lazyConnect to avoid eager connection in tests', () => {
    expect(readOrEmpty(CLIENT_TS)).toMatch(/lazyConnect:\s*true/);
  });
});

describe('Phase 12 WP 3.5 — revocation.ts', () => {
  it('exports revokeJwt + isJwtRevoked + areJwtsRevoked', () => {
    const src = readOrEmpty(REVOCATION_TS);
    expect(src).toMatch(/export\s+async\s+function\s+revokeJwt/);
    expect(src).toMatch(/export\s+async\s+function\s+isJwtRevoked/);
    expect(src).toMatch(/export\s+async\s+function\s+areJwtsRevoked/);
  });

  it('caps TTL at 86400 sec (defense against far-future exp)', () => {
    expect(readOrEmpty(REVOCATION_TS)).toMatch(/86400/);
  });

  it('uses fail-open semantics (null Redis → false, no lockout)', () => {
    const src = readOrEmpty(REVOCATION_TS);
    expect(src).toMatch(/fail-open/i);
    // Both functions return false on null client
    expect(src).toMatch(/if\s*\(!redis\)\s*return\s+false/);
  });

  it('uses SET key val EX ttl (single round-trip, atomic)', () => {
    expect(readOrEmpty(REVOCATION_TS)).toMatch(/'EX',\s*\w+/);
  });

  it('uses key prefix aisha:revoked: (namespaced)', () => {
    expect(readOrEmpty(REVOCATION_TS)).toMatch(/aisha:revoked:/);
  });
});

describe('Phase 12 WP 3.5 — index.ts barrel + usage docs', () => {
  it('barrel exports both client + revocation', () => {
    const src = readOrEmpty(INDEX_TS);
    expect(src).toMatch(/export\s+\*\s+from\s+['"]\.\/client\.js['"]/);
    expect(src).toMatch(/export\s+\*\s+from\s+['"]\.\/revocation\.js['"]/);
  });

  it('documents gateway middleware usage pattern', () => {
    const src = readOrEmpty(INDEX_TS);
    expect(src).toMatch(/preHandler/);
    expect(src).toMatch(/isJwtRevoked/);
    expect(src).toMatch(/revokeJwt/);
  });

  it('documents rollback via AISHA_SHARED_REDIS_DISABLED', () => {
    expect(readOrEmpty(INDEX_TS)).toMatch(/AISHA_SHARED_REDIS_DISABLED/);
  });
});
