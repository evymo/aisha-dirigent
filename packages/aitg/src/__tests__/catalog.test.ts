/**
 * AITG catalog tests — the TypeScript constant AITG_CATALOG in catalog.ts is the
 * source of truth for the 32-test OWASP AITG v1 set. (The DB's aitg_test_catalog
 * is DDL-only and the historical seed migration 20260516144654_aitg_baseline.sql
 * was folded into the baseline + archived, so there is no current SQL artifact to
 * mirror against — the SQL-parity block that used to read that migration was
 * removed under the baseline-only policy.) These assert the catalog's invariants
 * directly; if they drift, services using `aitgGetMeta()` disagree with the DB.
 */

import { describe, test, expect } from 'vitest';
import { AITG_CATALOG, AITG_CATALOG_BY_ID, aitgGetMeta, aitgListByLayer } from '../catalog.js';

describe('AITG catalog shape', () => {
  // OWASP AI Testing Guide v1 has 32 tests across 4 layers: 14 APP + 7 MOD + 6 INF + 5 DAT.
  // (The implementation plan's "44" summary was a typo — layer counts in the same plan sum to 32.)
  test('contains all 32 tests as per OWASP AITG v1 layer breakdown', () => {
    expect(AITG_CATALOG).toHaveLength(32);
  });

  test('every entry has a valid test_id', () => {
    for (const t of AITG_CATALOG) {
      expect(t.testId).toMatch(/^AITG-(APP|MOD|INF|DAT)-\d{2}$/);
    }
  });

  test('layer counts match OWASP spec: 14/7/6/5', () => {
    expect(aitgListByLayer('app')).toHaveLength(14);
    expect(aitgListByLayer('mod')).toHaveLength(7);
    expect(aitgListByLayer('inf')).toHaveLength(6);
    expect(aitgListByLayer('dat')).toHaveLength(5);
  });

  test('no duplicate test ids', () => {
    const ids = AITG_CATALOG.map((t) => t.testId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('severity_weight is positive', () => {
    for (const t of AITG_CATALOG) expect(t.severityWeight).toBeGreaterThan(0);
  });

  test('aitgGetMeta returns the right entry by id', () => {
    expect(aitgGetMeta('AITG-APP-01').layer).toBe('app');
    expect(aitgGetMeta('AITG-DAT-05').layer).toBe('dat');
  });

  test('aitgGetMeta throws on unknown id', () => {
    expect(() => aitgGetMeta('AITG-ZZZ-99')).toThrow('AITG_UNKNOWN_TEST_ID');
  });

  test('map size equals array length', () => {
    expect(AITG_CATALOG_BY_ID.size).toBe(AITG_CATALOG.length);
  });
});
