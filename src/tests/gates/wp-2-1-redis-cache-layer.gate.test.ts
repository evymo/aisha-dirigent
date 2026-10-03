/**
 * Gate test: Phase 12 WP 2.1 — Redis cache layer for svc-mcp-knowledge.
 *
 * Enforces:
 *   1. services/svc-mcp-knowledge/src/lib/cacheLayer.ts exists with
 *      the canonical embedding + query cache wrappers
 *   2. Uses @aisha/cache-redis DB index 1 (per §-1.12 R2)
 *   3. Embedding TTL = 24 h (86400s)
 *   4. Query TTL = 1 h (3600s)
 *   5. Pub/sub invalidation channel kb:invalidate:<story_id>
 *   6. SHA-256 hashing for cache keys (collision-resistant)
 *   7. Fail-open semantics (null Redis → null result, no throw)
 *   8. @aisha/cache-redis declared in svc-mcp-knowledge package.json
 *   9. cacheLayer uses node:crypto stdlib (no extra npm dep)
 *   10. No console.log in cacheLayer (CLAUDE.md -1.1)
 *   11. Subscriber uses SEPARATE Redis connection (psubscribe blocks)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const CACHE_LAYER = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/lib/cacheLayer.ts',
);
const PKG_JSON = path.join(ROOT, 'services/svc-mcp-knowledge/package.json');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 2.1 — cacheLayer.ts structure', () => {
  it('cacheLayer.ts exists', () => {
    expect(fs.existsSync(CACHE_LAYER)).toBe(true);
  });

  it('imports createNamespacedRedis from @aisha/cache-redis/client', () => {
    expect(readOrEmpty(CACHE_LAYER)).toMatch(
      /import.*createNamespacedRedis.*from\s+['"]@aisha\/cache-redis\/client['"]/,
    );
  });

  it('uses DB index 1 (per §-1.12 R2 — embedding + query cache)', () => {
    const src = readOrEmpty(CACHE_LAYER);
    expect(src).toMatch(/createNamespacedRedis\s*\(\s*\{[\s\S]*?db:\s*1[\s\S]*?\}/);
  });

  it('uses connectionName for Redis monitoring', () => {
    const src = readOrEmpty(CACHE_LAYER);
    expect(src).toMatch(/connectionName:\s*['"]svc-mcp-knowledge-cache['"]/);
  });

  it('embedding TTL = 24h (86400s)', () => {
    expect(readOrEmpty(CACHE_LAYER)).toMatch(/TTL_EMBEDDING_SEC\s*=\s*86_?400/);
  });

  it('query TTL = 1h (3600s)', () => {
    expect(readOrEmpty(CACHE_LAYER)).toMatch(/TTL_QUERY_SEC\s*=\s*3_?600/);
  });

  it('pub/sub invalidation channel kb:invalidate:<storyId>', () => {
    expect(readOrEmpty(CACHE_LAYER)).toMatch(/kb:invalidate:/);
  });
});

describe('Phase 12 WP 2.1 — exported API surface', () => {
  const src = readOrEmpty(CACHE_LAYER);

  it('exports buildEmbeddingKey + buildQueryKey', () => {
    expect(src).toMatch(/export\s+function\s+buildEmbeddingKey/);
    expect(src).toMatch(/export\s+function\s+buildQueryKey/);
  });

  it('exports getCachedEmbedding + setCachedEmbedding', () => {
    expect(src).toMatch(/export\s+async\s+function\s+getCachedEmbedding/);
    expect(src).toMatch(/export\s+async\s+function\s+setCachedEmbedding/);
  });

  it('exports getCachedQueryResult + setCachedQueryResult', () => {
    expect(src).toMatch(/export\s+async\s+function\s+getCachedQueryResult/);
    expect(src).toMatch(/export\s+async\s+function\s+setCachedQueryResult/);
  });

  it('exports publishInvalidation + subscribeToInvalidations', () => {
    expect(src).toMatch(/export\s+async\s+function\s+publishInvalidation/);
    expect(src).toMatch(/export\s+async\s+function\s+subscribeToInvalidations/);
  });

  it('exports invalidateStoryQueries + getCacheStats', () => {
    expect(src).toMatch(/export\s+async\s+function\s+invalidateStoryQueries/);
    expect(src).toMatch(/export\s+async\s+function\s+getCacheStats/);
  });
});

describe('Phase 12 WP 2.1 — implementation invariants', () => {
  const src = readOrEmpty(CACHE_LAYER);

  it('uses SHA-256 for cache key hashing (no MD5 / weak hash)', () => {
    expect(src).toMatch(/createHash\s*\(\s*['"]sha256['"]/);
    expect(src).not.toMatch(/createHash\s*\(\s*['"]md5['"]/);
  });

  it('uses node:crypto stdlib (no extra npm dep)', () => {
    expect(src).toMatch(/from\s+['"]node:crypto['"]/);
    expect(src).not.toMatch(/from\s+['"]crypto-js['"]/);
  });

  it('fail-open: returns null on missing Redis client', () => {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Multiple `if (!redis) return null` or similar patterns
    const failOpenCount = (stripped.match(/if\s*\(\s*!\s*redis\s*\)\s*return\s+(null|false|0|\{)/g) ?? []).length;
    expect(failOpenCount).toBeGreaterThanOrEqual(3);
  });

  it('fail-open: catches Redis errors + returns null/false', () => {
    expect(src).toMatch(/catch\s*\{\s*[\s\S]*?return\s+(null|false|0)/);
  });

  it('subscriber uses SEPARATE Redis client (psubscribe blocks connection)', () => {
    expect(src).toMatch(/subscribeToInvalidations[\s\S]*?createNamespacedRedis/);
    expect(src).toMatch(/connectionName:\s*['"]svc-mcp-knowledge-cache-sub['"]/);
  });

  it('uses SCAN (not KEYS) to avoid blocking Redis on large keyspace', () => {
    expect(src).toMatch(/scanStream/);
    expect(src).not.toMatch(/redis\.keys\s*\(/);
  });

  it('NO console.log (use proper logger per CLAUDE.md -1.1)', () => {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bconsole\.log\s*\(/);
  });

  it('NO `: any` type annotations (per CLAUDE.md -1.1)', () => {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/:\s*any\b/);
  });
});

describe('Phase 12 WP 2.1 — svc-mcp-knowledge package wiring', () => {
  it('package.json declares @aisha/cache-redis dep', () => {
    const pkg = JSON.parse(readOrEmpty(PKG_JSON)) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@aisha/cache-redis']).toBeDefined();
  });

  it('@aisha/cache-redis comes BEFORE @aisha/observability (alphabetical)', () => {
    const src = readOrEmpty(PKG_JSON);
    const depsBlockMatch = src.match(/"dependencies":\s*\{([\s\S]*?)\}/);
    expect(depsBlockMatch).not.toBeNull();
    const depsBlock = depsBlockMatch![1];
    const cacheIdx = depsBlock.indexOf('"@aisha/cache-redis"');
    const obsIdx = depsBlock.indexOf('"@aisha/observability"');
    expect(cacheIdx).toBeGreaterThanOrEqual(0);
    expect(obsIdx).toBeGreaterThanOrEqual(0);
    expect(cacheIdx, '@aisha/cache-redis should come before @aisha/observability').toBeLessThan(obsIdx);
  });
});
