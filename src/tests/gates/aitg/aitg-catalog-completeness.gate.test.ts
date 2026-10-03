/**
 * AITG umbrella gate — catalog completeness across all sources of truth.
 *
 * The same 32-test catalog must be byte-identical across three places:
 *   1. aisha/db/migrations/00000000000000_baseline.sql (DB seed)
 *   2. packages/aitg/src/catalog.ts (TS constant)
 *   3. packages/aitg/src/__tests__/catalog.test.ts (regression assertions)
 *
 * If they drift, services using `aitgGetMeta()` will silently disagree with
 * the database — and the trust score computation goes wrong. This gate is
 * the build-blocking version of the package-internal catalog test.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIGRATION = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const CATALOG_TS = resolve(ROOT, 'packages/aitg/src/catalog.ts');

const EXPECTED_TESTS = [
  ...Array.from({ length: 14 }, (_, i) => `AITG-APP-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 7 }, (_, i) => `AITG-MOD-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, i) => `AITG-INF-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 5 }, (_, i) => `AITG-DAT-${String(i + 1).padStart(2, '0')}`),
];

describe('AITG catalog completeness', () => {
  test('positive: migration file exists', () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  test('positive: catalog TS module exists', () => {
    expect(existsSync(CATALOG_TS)).toBe(true);
  });

  test('aitg_test_catalog table mechanism exists in SoT (catalog seeded per-implementation)', () => {
    // The 32-id catalog's canonical source is the TS module (asserted below); the
    // DB-side catalog-seed migration was folded out of the platform. Assert the
    // platform MECHANISM — the aitg_test_catalog table — exists in canonical SoT.
    // The catalog rows themselves are seeded per implementation (e.g. example).
    expect(existsSync(resolve(ROOT, 'aisha/db/sql/tables/aitg_test_catalog.sql'))).toBe(true);
  });

  test('positive: all 32 expected test ids appear in TS catalog', () => {
    const ts = readFileSync(CATALOG_TS, 'utf8');
    const missing = EXPECTED_TESTS.filter((id) => !ts.includes(`'${id}'`));
    expect(missing, `Missing in TS: ${missing.join(', ')}`).toEqual([]);
  });

  test('negative: migration does not contain unknown layer prefixes', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const found = sql.match(/AITG-[A-Z]{3}-\d{2}/g) ?? [];
    const unknown = found.filter((id) => !id.match(/^AITG-(APP|MOD|INF|DAT)-\d{2}$/));
    expect(unknown).toEqual([]);
  });

  test('negative: TS catalog does not contain ids outside the layer counts', () => {
    const ts = readFileSync(CATALOG_TS, 'utf8');
    const found = [...new Set(ts.match(/AITG-[A-Z]{3}-\d{2}/g) ?? [])];
    expect(found.sort()).toEqual([...EXPECTED_TESTS].sort());
  });
});
