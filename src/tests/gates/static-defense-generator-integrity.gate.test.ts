/**
 * Static defense generator integrity gate
 *
 * Phase 6 — DB-as-SoT for static defense rules. This gate enforces:
 *
 *   1. SoT table + RPC files exist for aisha_static_defense_rules
 *   2. The canonical rule ROWS live in the seed corpus (DB-less SoT), not in
 *      an archived historical migration
 *   3. Generator script scripts/gen-static-defense.mjs exists
 *   4. Generator can build payload from the seed corpus alone (no DB)
 *   5. .semgrep/aisha-rules.yml has the AUTO-GENERATED header
 *   6. `--from-seed --check` reports no drift between rendered + committed YAML
 *
 * Source-of-truth split (baseline-only invariant): the TABLE schema is folded
 * into the generated baseline via aisha/db/sql/tables; the rule ROWS live in
 * aisha/db/seed/core/*_aisha_static_defense_rules.sql (same pattern as
 * 27_plugin_transition_rules.sql). The historical migration that once carried
 * both is archived/deleted and is NOT read by this gate or the generator.
 *
 * Why --from-seed (not --offline + committed cache): per project rule
 * `feedback_aisha_dir_is_generated`, the `.aisha/` directory is generated
 * workspace produced by the VSCode "Aisha Dirigent" extension or by the
 * stack backend via that extension. It MUST NOT contain hand-built artifacts
 * committed to git. CI therefore can't read a committed payload cache;
 * instead the gate uses the generator's `--from-seed` mode, which parses
 * the canonical `aisha/db/seed/core/*_aisha_static_defense_rules.sql` seed and
 * renders the YAML from there.
 *
 * Drift between live DB and seed migration is not this gate's job — that
 * would be caught by a separate Dirigent reconciliation job that watches
 * `aisha_static_defense_rules.updated_at` and surfaces unflushed deltas.
 *
 * Per the no-workarounds principle: this gate is the LIVE CONTRACT that
 * .semgrep/aisha-rules.yml is auto-generated, not hand-written.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();
// Canonical DB-less SoT for the rule ROWS (table schema lives in the baseline
// via TABLE_SOT; rows live in the seed corpus). This is the file the generator
// parses in --from-seed mode — replaces the archived historical migration.
const SEED_SOT = resolve(ROOT, 'aisha/db/seed/core/32_aisha_static_defense_rules.sql');
const TABLE_SOT = resolve(ROOT, 'aisha/db/sql/tables/aisha_static_defense_rules.sql');
const RPC_SOT = resolve(ROOT, 'aisha/db/sql/functions/aisha_get_active_static_defense_rules.sql');
const GENERATOR = resolve(ROOT, 'scripts/gen-static-defense.mjs');
const SEMGREP_RULES = resolve(ROOT, '.semgrep/aisha-rules.yml');

describe('Static defense generator integrity gate (Phase 6)', () => {
  test('canonical rule ROWS live in the seed corpus (DB-less SoT)', () => {
    // The seed-data property formerly carried by the historical migration:
    // the active rule rows must exist in a DB-less, committed source of truth so
    // the generator can render the YAML without a DB and without reading an
    // archived migration. (Table + RPC DDL presence is asserted separately
    // against TABLE_SOT / RPC_SOT below — folded into the baseline, not here.)
    expect(existsSync(SEED_SOT), `Missing static-defense seed SoT: ${SEED_SOT}`).toBe(true);
    const content = readFileSync(SEED_SOT, 'utf-8');
    // Seeds the canonical table.
    expect(content).toMatch(/INSERT INTO public\.aisha_static_defense_rules/);
    // Idempotent cold-start seed (re-applies safely).
    expect(content).toMatch(/ON CONFLICT \(rule_id\) DO NOTHING/);
    // At least the active semgrep rules the committed YAML is generated from.
    expect(content).toMatch(/'aisha-raw-fetch-outside-ssrf-guard'/);
    expect(content).toMatch(/'aitg-llm-import-without-guard'/);
    // Rows are marked active — only 'active' rows are exported by the generator
    // / aisha_get_active_static_defense_rules.
    expect(content).toMatch(/'active'/);
  });

  test('table SoT file exists', () => {
    expect(existsSync(TABLE_SOT), `Missing SoT: ${TABLE_SOT}`).toBe(true);
    const content = readFileSync(TABLE_SOT, 'utf-8');
    expect(content).toMatch(/CREATE TABLE IF NOT EXISTS public\.aisha_static_defense_rules/);
    expect(content).toMatch(/ALTER TABLE.*ENABLE ROW LEVEL SECURITY/);
  });

  test('RPC SoT file has canonical SECURITY DEFINER pattern', () => {
    expect(existsSync(RPC_SOT), `Missing SoT: ${RPC_SOT}`).toBe(true);
    const content = readFileSync(RPC_SOT, 'utf-8');
    expect(content).toMatch(/SECURITY DEFINER/);
    expect(content).toMatch(/SET search_path TO 'public'/);
    expect(content).toMatch(/REVOKE ALL ON FUNCTION.*FROM PUBLIC/);
    expect(content).toMatch(/GRANT EXECUTE.*TO authenticated/);
    expect(content).toMatch(/GRANT EXECUTE.*TO service_role/);
  });

  test('generator script exists', () => {
    expect(existsSync(GENERATOR), `Missing generator: ${GENERATOR}`).toBe(true);
  });

  test('generator can build payload from seed corpus alone (no DB, no cache)', () => {
    // --from-seed mode emits the rule count it parsed; we just need it to
    // exit 0 and find at least one rule. If the seed parser regresses, the
    // generator will throw and exit non-zero — caught here.
    const result = spawnSync('node', [GENERATOR, '--from-seed', '--check'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    expect(
      result.status,
      `--from-seed --check failed:\nstdout: ${stdout}\nstderr: ${stderr}`,
    ).toBe(0);
    // Sanity: at least one rule parsed from the seed corpus (not a migration).
    expect(stdout).toMatch(/parsed \d+ rules from seed-core:/);
  });

  test('.semgrep/aisha-rules.yml has AUTO-GENERATED header (never hand-edit)', () => {
    expect(existsSync(SEMGREP_RULES)).toBe(true);
    const content = readFileSync(SEMGREP_RULES, 'utf-8');
    expect(content).toMatch(/AUTO-GENERATED from public\.aisha_static_defense_rules/);
    expect(content).toMatch(/DO NOT EDIT MANUALLY/);
  });

  test('generator --from-seed --check produces no drift vs committed YAML', () => {
    // CI's primary contract test: render YAML from the seed migration and
    // diff against the committed `.semgrep/aisha-rules.yml`. No DB, no
    // cache file — `.aisha/` stays a pure runtime-generated workspace.
    const result = spawnSync('node', [GENERATOR, '--from-seed', '--check'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    expect(
      result.status,
      `Generator --from-seed --check detected drift: ${result.stderr?.toString() ?? ''}. Run \`npm run gen:static-defense:from-seed\` and commit the regenerated YAML.`,
    ).toBe(0);
  });

  test('npm scripts gen:static-defense are wired', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['gen:static-defense']).toBeDefined();
    expect(pkg.scripts?.['gen:static-defense:offline']).toBeDefined();
    expect(pkg.scripts?.['gen:static-defense:from-seed']).toBeDefined();
    expect(pkg.scripts?.['gen:static-defense:check']).toBeDefined();
  });
});
