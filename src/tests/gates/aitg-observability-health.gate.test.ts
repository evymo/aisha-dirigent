/**
 * AITG observability health gate
 *
 * Verifies the read-only observability RPC `aitg_observability_health_audited`
 * exists with canonical SECURITY DEFINER pattern, so operators (Appsmith
 * dashboard) and monitoring workflows can confirm the AITG autonomy loop
 * is actually firing — not just declared in workflow definitions.
 *
 * The gap this closes: every previous defense layer ASSUMES the n8n
 * workflows (continuous 15min, nightly 03:30, reflection 06:00, sentinel
 * webhook, PR gate webhook) actually invoke probes and write to aitg_runs.
 * Without a health RPC, no automated check verifies that assumption.
 * The defense gates would all pass even if the cron stopped firing weeks
 * ago — "paper coverage" with no real signal.
 *
 * This gate is static (verifies the RPC exists with correct shape).
 * Runtime verification (was anything inserted in last 24h?) is enforced
 * by WF_AITG_DAILY_REFLECTION which calls the RPC and alerts on
 * `overall_status: 'no_activity_24h'` / `'failures_present'`.
 *
 * Why static-first: CI runs without a live DB, so we can't query
 * aitg_runs directly in this gate. What we CAN do is verify the
 * observability mechanism is wired (RPC SoT + migration + audit-journal
 * action recorded).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RPC_SOT = resolve(ROOT, 'aisha/db/sql/functions/aitg_observability_health_audited.sql');
const MIGRATION = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');

describe('AITG observability health gate', () => {
  test('RPC SoT file exists', () => {
    expect(existsSync(RPC_SOT), `Missing SoT: ${RPC_SOT}`).toBe(true);
  });

  test('migration exists + creates the RPC', () => {
    expect(existsSync(MIGRATION), `Missing migration: ${MIGRATION}`).toBe(true);
    const content = readFileSync(MIGRATION, 'utf-8');
    expect(content).toMatch(/CREATE OR REPLACE FUNCTION public\.aitg_observability_health_audited/);
  });

  test('RPC has canonical SECURITY DEFINER pattern', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    expect(content).toMatch(/SECURITY DEFINER/);
    expect(content).toMatch(/SET search_path TO 'public'/);
    expect(content).toMatch(/STABLE/);
    expect(content).toMatch(/REVOKE ALL ON FUNCTION.*FROM PUBLIC/s);
    expect(content).toMatch(/GRANT EXECUTE.*TO authenticated/s);
    expect(content).toMatch(/GRANT EXECUTE.*TO service_role/s);
  });

  test('RPC enforces admin-or-staff (or service_role) — anon read denied', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    // Should call is_admin_or_staff() and check service_role claim
    expect(content).toMatch(/is_admin_or_staff\(\)/);
    expect(content).toMatch(/service_role/);
    // Must NOT grant anon
    expect(content).not.toMatch(/GRANT EXECUTE.*TO anon/s);
  });

  test('RPC categorizes runs by triggered_by source', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    expect(content).toMatch(/GROUP BY .*triggered_by/);
  });

  test('RPC tracks 24h + 7d windows + last_seen freshness', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    expect(content).toMatch(/interval '24 hours'/);
    expect(content).toMatch(/interval '7 days'/);
    expect(content).toMatch(/last_seen/);
    expect(content).toMatch(/last_seen_age_minutes/);
  });

  test('RPC emits structured overall_status for monitoring', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    // Status values that drive alerting
    expect(content).toMatch(/'no_activity_24h'/);
    expect(content).toMatch(/'failures_present'/);
    expect(content).toMatch(/'low_activity'/);
    expect(content).toMatch(/'healthy'/);
  });

  test('RPC audit-journals the query itself (incident-response trail)', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    expect(content).toMatch(/INSERT INTO public\.audit_journal/);
    expect(content).toMatch(/'aitg_observability_health_queried'/);
  });

  test('expected sources cover all 5 trigger types from workflow catalog', () => {
    const content = readFileSync(RPC_SOT, 'utf-8');
    // These match aitg_runs.triggered_by CHECK constraint values
    for (const source of ['pr-gate', 'nightly', 'manual', 'sentinel', 'self']) {
      expect(
        content,
        `RPC must reference expected source "${source}" so monitoring catches a missing schedule`,
      ).toContain(`'${source}'`);
    }
  });
});
