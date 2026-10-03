/**
 * Drift canary — validates a SourceContract against the live source schema.
 *
 * The seam's change-resilience guard. Runs at broker startup and before each
 * sync tick. Detects three drift modes against the external source:
 *   - MISSING TABLE   : a table the broker reads no longer exists (rename/drop)
 *   - MISSING COLUMN  : a column the broker reads no longer exists (rename/drop)
 *   - TYPE MISMATCH   : a column's type changed incompatibly (soft warning)
 *
 * Policy: MISSING table/column = hard drift → caller must refuse to advance the
 * sync cursor (so it doesn't overwrite good aisha data with zeros) and alarm.
 * TYPE MISMATCH = soft drift → warn, but proceed (varchar↔text etc. are benign;
 * a genuinely breaking type change will surface as a query error, which the
 * scheduler already records).
 *
 * Generic by design: works for ANY SourceContract, so every future data source
 * inherits the same drift detection. This is the reusable seam, not a source
 * one-off.
 */

import type { Client as PgClient } from 'pg';
import type { SourceContract } from './source-contract.js';

export interface DriftIssue {
  kind: 'missing_table' | 'missing_column' | 'type_mismatch';
  table: string;
  column?: string;
  expected?: string;
  actual?: string;
}

export interface DriftReport {
  source: string;
  ok: boolean;          // true ⇢ no HARD drift (missing table/column)
  hardDrift: boolean;   // missing table or column — caller must NOT advance cursor
  softDrift: boolean;   // type mismatches only
  issues: DriftIssue[];
  checkedAt: string;    // ISO timestamp
}

/**
 * Verify a source contract against the live schema.
 *
 * Single round-trip: one query over information_schema.columns for all
 * contract tables, then compared in memory. Read-only; safe to run frequently.
 *
 * @param pg        a CONNECTED pg Client pointed at the source database
 * @param contract  the SourceContract to validate
 * @param nowIso    timestamp to stamp the report with (passed in for testability;
 *                  Date.now() is avoided so callers control time in tests)
 */
export async function verifyContract(
  pg: PgClient,
  contract: SourceContract,
  nowIso: string
): Promise<DriftReport> {
  const issues: DriftIssue[] = [];

  const tableNames = contract.tables.map((t) => t.table);
  // Fetch every column for the contract's tables in one query.
  const res = await pg.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])`,
    [contract.schema, tableNames]
  );

  // Index live columns: table → (column → data_type)
  const live = new Map<string, Map<string, string>>();
  for (const row of res.rows) {
    if (!live.has(row.table_name)) live.set(row.table_name, new Map());
    live.get(row.table_name)!.set(row.column_name, row.data_type);
  }

  for (const tc of contract.tables) {
    const liveCols = live.get(tc.table);
    if (!liveCols || liveCols.size === 0) {
      issues.push({ kind: 'missing_table', table: tc.table });
      continue; // can't check columns of a missing table
    }
    for (const col of tc.columns) {
      const actualType = liveCols.get(col.name);
      if (actualType === undefined) {
        issues.push({ kind: 'missing_column', table: tc.table, column: col.name });
        continue;
      }
      const accepted = [col.type, ...(col.acceptableTypes ?? [])];
      if (!accepted.includes(actualType)) {
        issues.push({
          kind: 'type_mismatch',
          table: tc.table,
          column: col.name,
          expected: accepted.join(' | '),
          actual: actualType,
        });
      }
    }
  }

  const hardDrift = issues.some(
    (i) => i.kind === 'missing_table' || i.kind === 'missing_column'
  );
  const softDrift = issues.some((i) => i.kind === 'type_mismatch');

  return {
    source: contract.source,
    ok: !hardDrift,
    hardDrift,
    softDrift,
    issues,
    checkedAt: nowIso,
  };
}

/** Compact human-readable summary for logs. */
export function summarizeDrift(report: DriftReport): string {
  if (report.issues.length === 0) return `contract OK (${report.source})`;
  const parts = report.issues.map((i) => {
    switch (i.kind) {
      case 'missing_table':
        return `MISSING TABLE ${i.table}`;
      case 'missing_column':
        return `MISSING COLUMN ${i.table}.${i.column}`;
      case 'type_mismatch':
        return `TYPE ${i.table}.${i.column} expected ${i.expected} got ${i.actual}`;
    }
  });
  return `${report.hardDrift ? 'HARD' : 'soft'} drift (${report.source}): ${parts.join('; ')}`;
}
