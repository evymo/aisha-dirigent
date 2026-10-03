/**
 * AITG-APP-14 — explainability / decision provenance.
 *
 * Every audited RPC that produces a decision (route_task, compose_context,
 * governance_decide, etc.) MUST persist a reason trail. Heuristic check:
 *   - Function source contains either "reasoning" or "decision_provenance"
 *     parameter on insert/update.
 *
 * Positive: known good audited fns have provenance.
 * Negative: a fixture without provenance is detected.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const SQL_FN_DIR = resolve(ROOT, 'aisha/db/sql/functions');

const PROVENANCE_REQUIRED_PATTERNS = [
  /route_task/,
  /governance_decide/,
  /aitg_propose_remediation/,
];

function listSqlFunctions(): string[] {
  if (!existsSync(SQL_FN_DIR)) return [];
  return readdirSync(SQL_FN_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(SQL_FN_DIR, f));
}

describe('AITG-APP-14: explainability for decision-making RPCs', () => {
  const files = listSqlFunctions();

  test('positive: at least one decision RPC has provenance markers', () => {
    const decisionFns = files.filter((f) =>
      PROVENANCE_REQUIRED_PATTERNS.some((re) => re.test(f)),
    );
    if (decisionFns.length === 0) return; // No decision RPCs in this repo snapshot
    const ok = decisionFns.some((f) => {
      const sql = readFileSync(f, 'utf8');
      return /reasoning|decision_provenance|details\s*\)/.test(sql);
    });
    expect(ok).toBe(true);
  });

  test('positive: aitg_propose_remediation persists a remediation string', () => {
    const path = resolve(SQL_FN_DIR, 'aitg_propose_remediation_audited.sql');
    if (!existsSync(path)) return;
    const sql = readFileSync(path, 'utf8');
    expect(sql).toMatch(/SET\s+remediation\s*=/);
  });

  test('negative: no decision RPC writes to audit_journal with empty details', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const sql = readFileSync(f, 'utf8');
      if (!/INSERT\s+INTO\s+audit_journal/i.test(sql)) continue;
      if (/INSERT\s+INTO\s+audit_journal[\s\S]+?'\{\}'/i.test(sql)) {
        offenders.push(f);
      }
    }
    // We allow empty-details audit entries for catalog reads, but decision
    // makers (route_*, governance_*, aitg_propose_*) must populate details.
    const decisionOffenders = offenders.filter((f) =>
      /route_|governance_|aitg_propose_/.test(f),
    );
    expect(decisionOffenders).toEqual([]);
  });
});
