/**
 * Drift canary tests — the seam's change-resilience guard.
 *
 * We mock a pg Client whose information_schema.columns response we control,
 * then assert the canary classifies drift correctly: missing table/column =
 * hard drift (must block sync); type mismatch = soft drift (warn only).
 */

import { describe, it, expect } from 'vitest';
import { verifyContract, summarizeDrift } from '../contracts/drift-canary.js';
import type { SourceContract } from '../contracts/source-contract.js';

const NOW = '2026-05-24T00:00:00.000Z';

const CONTRACT: SourceContract = {
  source: 'test-source',
  schema: 'public',
  tables: [
    {
      table: 'core_appuser',
      columns: [
        { name: 'id', type: 'uuid' },
        { name: 'email', type: 'text', acceptableTypes: ['character varying'] },
        { name: 'last_activity', type: 'timestamp with time zone' },
      ],
    },
    {
      table: 'core_event',
      columns: [
        { name: 'id', type: 'uuid' },
        { name: 'cancelled', type: 'boolean' },
      ],
    },
  ],
};

/** Build a fake pg Client returning the given information_schema rows. */
function fakePg(rows: Array<{ table_name: string; column_name: string; data_type: string }>) {
  return {
    query: async () => ({ rows, rowCount: rows.length }),
  } as unknown as import('pg').Client;
}

describe('verifyContract — no drift', () => {
  it('passes when every contract column exists with an accepted type', async () => {
    const pg = fakePg([
      { table_name: 'core_appuser', column_name: 'id', data_type: 'uuid' },
      { table_name: 'core_appuser', column_name: 'email', data_type: 'character varying' }, // accepted alt
      { table_name: 'core_appuser', column_name: 'last_activity', data_type: 'timestamp with time zone' },
      { table_name: 'core_event', column_name: 'id', data_type: 'uuid' },
      { table_name: 'core_event', column_name: 'cancelled', data_type: 'boolean' },
    ]);
    const report = await verifyContract(pg, CONTRACT, NOW);
    expect(report.ok).toBe(true);
    expect(report.hardDrift).toBe(false);
    expect(report.softDrift).toBe(false);
    expect(report.issues).toHaveLength(0);
    expect(report.checkedAt).toBe(NOW);
  });
});

describe('verifyContract — hard drift', () => {
  it('flags a missing column as hard drift', async () => {
    const pg = fakePg([
      { table_name: 'core_appuser', column_name: 'id', data_type: 'uuid' },
      // email renamed away → missing
      { table_name: 'core_appuser', column_name: 'last_activity', data_type: 'timestamp with time zone' },
      { table_name: 'core_event', column_name: 'id', data_type: 'uuid' },
      { table_name: 'core_event', column_name: 'cancelled', data_type: 'boolean' },
    ]);
    const report = await verifyContract(pg, CONTRACT, NOW);
    expect(report.hardDrift).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      kind: 'missing_column', table: 'core_appuser', column: 'email',
    });
  });

  it('flags a missing table as hard drift and skips its column checks', async () => {
    const pg = fakePg([
      { table_name: 'core_appuser', column_name: 'id', data_type: 'uuid' },
      { table_name: 'core_appuser', column_name: 'email', data_type: 'text' },
      { table_name: 'core_appuser', column_name: 'last_activity', data_type: 'timestamp with time zone' },
      // core_event entirely gone
    ]);
    const report = await verifyContract(pg, CONTRACT, NOW);
    expect(report.hardDrift).toBe(true);
    expect(report.issues).toContainEqual({ kind: 'missing_table', table: 'core_event' });
    // no per-column issues for the missing table
    expect(report.issues.filter((i) => i.table === 'core_event' && i.column)).toHaveLength(0);
  });
});

describe('verifyContract — soft drift', () => {
  it('flags an unexpected type as soft drift (not hard)', async () => {
    const pg = fakePg([
      { table_name: 'core_appuser', column_name: 'id', data_type: 'uuid' },
      { table_name: 'core_appuser', column_name: 'email', data_type: 'text' },
      // last_activity changed to plain timestamp (no tz) — type mismatch
      { table_name: 'core_appuser', column_name: 'last_activity', data_type: 'timestamp without time zone' },
      { table_name: 'core_event', column_name: 'id', data_type: 'uuid' },
      { table_name: 'core_event', column_name: 'cancelled', data_type: 'boolean' },
    ]);
    const report = await verifyContract(pg, CONTRACT, NOW);
    expect(report.hardDrift).toBe(false);
    expect(report.softDrift).toBe(true);
    expect(report.ok).toBe(true); // soft drift does not block sync
    expect(report.issues).toContainEqual({
      kind: 'type_mismatch',
      table: 'core_appuser',
      column: 'last_activity',
      expected: 'timestamp with time zone',
      actual: 'timestamp without time zone',
    });
  });
});

describe('summarizeDrift', () => {
  it('produces a compact OK summary when clean', () => {
    expect(summarizeDrift({
      source: 'x', ok: true, hardDrift: false, softDrift: false, issues: [], checkedAt: NOW,
    })).toMatch(/contract OK/);
  });

  it('labels hard drift', async () => {
    const pg = fakePg([]); // everything missing
    const report = await verifyContract(pg, CONTRACT, NOW);
    expect(summarizeDrift(report)).toMatch(/HARD drift/);
    expect(summarizeDrift(report)).toMatch(/MISSING TABLE/);
  });
});
