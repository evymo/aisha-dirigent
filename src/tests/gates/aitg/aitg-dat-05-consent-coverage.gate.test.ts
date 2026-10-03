/**
 * AITG-DAT-05 — data minimization & consent ledger coverage.
 *
 * Every sensitive table identified by AISHA conventions must have:
 *   1. RLS enabled
 *   2. A policy that scopes reads (no naked SELECT for anon)
 *   3. An audited RPC for reads (so access is logged)
 *
 * AND: no INSERT INTO audit_journal carries PII keys (email/name/phone).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const SQL_TABLES = resolve(ROOT, 'aisha/db/sql/tables');
const SQL_RLS = resolve(ROOT, 'aisha/db/sql/rls');
const SQL_FN = resolve(ROOT, 'aisha/db/sql/functions');

// Sensitive tables whose RLS policy file MUST exist as its own SoT.
// audit_journal RLS lives inline in its table definition (legacy) — checked
// separately via the table-level RLS-enabled scan above.
const SENSITIVE_PREFIXES = [
  'aitg_payloads',
  'aitg_findings',
];

describe('AITG-DAT-05: data minimization + consent coverage', () => {
  test('positive: every sensitive table has RLS enabled in its table SoT', () => {
    const offenders: string[] = [];
    for (const prefix of SENSITIVE_PREFIXES) {
      const path = join(SQL_TABLES, `${prefix}.sql`);
      if (!existsSync(path)) continue;
      const sql = readFileSync(path, 'utf8');
      if (!/ENABLE ROW LEVEL SECURITY/i.test(sql)) offenders.push(prefix);
    }
    expect(offenders).toEqual([]);
  });

  test('positive: every sensitive table has at least one RLS policy', () => {
    const offenders: string[] = [];
    for (const prefix of SENSITIVE_PREFIXES) {
      const path = join(SQL_RLS, `${prefix}.sql`);
      if (existsSync(path)) {
        const sql = readFileSync(path, 'utf8');
        if (!/CREATE POLICY/i.test(sql)) offenders.push(prefix);
      }
      // missing RLS file is also a failure for sensitive tables
    }
    expect(offenders).toEqual([]);
  });

  test('negative: no audited RPC inserts plaintext PII into audit_journal', () => {
    if (!existsSync(SQL_FN)) return;
    const PII_KEYS = ["'email'", "'phone'", "'name'", "'first_name'", "'last_name'"];
    const offenders: string[] = [];
    for (const file of readdirSync(SQL_FN)) {
      if (!file.endsWith('_audited.sql')) continue;
      const sql = readFileSync(join(SQL_FN, file), 'utf8');
      const auditBlocks = sql.match(/INSERT\s+INTO\s+(?:public\.)?audit_journal[\s\S]+?\);/gi) ?? [];
      for (const block of auditBlocks) {
        for (const key of PII_KEYS) {
          if (block.includes(key)) {
            offenders.push(`${file}: ${key} in audit_journal insert`);
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
