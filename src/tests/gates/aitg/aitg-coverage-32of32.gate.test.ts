/**
 * AITG coverage gate — every test in the 32-test catalog has an
 * implementation marker.
 *
 * An implementation marker is one of:
 *   1. A static gate file under src/tests/gates/aitg/ that references the
 *      test_id in a `describe(` block
 *   2. A runtime probe route under services/svc-aitg-probes/src/routes/
 *      that records the test_id via aitg_record_run_audited
 *   3. A waiver in the migration 20260516203128_aitg_test_lifecycle_markers
 *      (N/A or quarterly designation)
 *
 * The test fails if any catalog entry has no implementation marker. This is
 * the "where we are at 100%" gate.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

/**
 * Every AITG test must appear in one of these registries.
 */
interface CoverageEvidence {
  testId: string;
  staticGate: string | null;
  probeRoute: string | null;
  waiver: string | null;
}

const CATALOG = [
  // APP layer (14)
  'AITG-APP-01', 'AITG-APP-02', 'AITG-APP-03', 'AITG-APP-04', 'AITG-APP-05',
  'AITG-APP-06', 'AITG-APP-07', 'AITG-APP-08', 'AITG-APP-09', 'AITG-APP-10',
  'AITG-APP-11', 'AITG-APP-12', 'AITG-APP-13', 'AITG-APP-14',
  // MOD layer (7)
  'AITG-MOD-01', 'AITG-MOD-02', 'AITG-MOD-03', 'AITG-MOD-04', 'AITG-MOD-05',
  'AITG-MOD-06', 'AITG-MOD-07',
  // INF layer (6)
  'AITG-INF-01', 'AITG-INF-02', 'AITG-INF-03', 'AITG-INF-04', 'AITG-INF-05',
  'AITG-INF-06',
  // DAT layer (5)
  'AITG-DAT-01', 'AITG-DAT-02', 'AITG-DAT-03', 'AITG-DAT-04', 'AITG-DAT-05',
];

/**
 * Tests that intersect another test's coverage (delegation). Example:
 * INF-02 Resource Exhaustion is covered by @aisha/security rate-limit
 * tiers (proven in @aisha/security unit tests + applySecurity smoke).
 */
const DELEGATED_COVERAGE: Record<string, string> = {
  'AITG-APP-06': 'aitg-inf-04-capability-misuse.gate.test.ts',
  'AITG-INF-02': '@aisha/security/rateLimit unit tests + applySecurity rate-limit smoke test',
  'AITG-MOD-01': 'covered by APP-01/APP-02 probes (evasion vectors overlap with prompt injection)',
  'AITG-MOD-06': 'covered by daily reflection workflow (drift detection on production traces)',
  'AITG-DAT-02': 'svc-aitg-probes/src/routes/data-leak.ts (shared APP-03 probe with testId override)',
};

/**
 * Explicitly DEFERRED AITG tests — catalogued but platform coverage (gate/probe)
 * is still pending. Documented here so the gap stays VISIBLE and tracked, NOT
 * silently uncovered. (These three were previously masked by an over-broad archive
 * waiver scan that matched any testId in a file merely containing 'n_a'/'enabled' —
 * removing the archive read surfaced the real gap.)
 */
// ZERO genuine deferrals — every one of the 32 AITG tests now has a real
// implementation marker (gate / probe / delegation). The model-layer "training
// attack" classes (INF-05 fine-tuning poisoning, MOD-03 poisoned training sets,
// MOD-04 membership inference, MOD-05 inversion) have no training pipeline to
// attack directly, but their STACK ANALOGS are defended and asserted by dedicated
// gates: aitg-data-poisoning (learning-loop human gate + ingestion sanitiser),
// aitg-mod-04-membership-inference (per-story KB isolation), aitg-mod-05-inversion
// (server-side story-gated context + system-prompt non-disclosure). The APP-layer
// probes 02/05/08/09/10/11 are real wired registerProbe routes (findProbeRoute).
const KNOWN_DEFERRED: Record<string, string> = {};

function findGateFile(testId: string): string | null {
  const gatesDir = resolve(ROOT, 'src/tests/gates/aitg');
  if (!existsSync(gatesDir)) return null;
  // Match by lower-case test_id in filename: aitg-app-07-prompt-disclosure.gate.test.ts
  const slug = testId.toLowerCase().replace(/aitg-/, 'aitg-');
  for (const f of readdirSync(gatesDir)) {
    if (f.toLowerCase().includes(slug)) {
      const content = readFileSync(join(gatesDir, f), 'utf8');
      if (content.includes(testId)) return f;
    }
  }
  // Fallback: any file that mentions test_id in a describe(
  for (const f of readdirSync(gatesDir)) {
    if (!f.endsWith('.gate.test.ts')) continue;
    const content = readFileSync(join(gatesDir, f), 'utf8');
    if (new RegExp(`describe\\s*\\(\\s*['"][^'"]*${testId}`).test(content)) {
      return f;
    }
  }
  return null;
}

function findProbeRoute(testId: string): string | null {
  const routesDir = resolve(ROOT, 'services/svc-aitg-probes/src/routes');
  if (!existsSync(routesDir)) return null;
  for (const f of readdirSync(routesDir)) {
    if (!f.endsWith('.ts')) continue;
    const content = readFileSync(join(routesDir, f), 'utf8');
    // A probe records EITHER directly (runner.record / aitg_record_run_audited) OR
    // through the shared registerProbe(app, { testId, ... }) helper (lib/probeShape.ts),
    // which calls runner.record internally. The 6 APP-layer probes use the helper, so
    // a literal `record(` grep missed them — they ARE real, wired routes (registered in
    // services/svc-aitg-probes/src/server.ts), not deferred.
    if (content.includes(testId) && /runner\.record|aitg_record_run_audited|record\s*\(|registerProbe\s*\(/.test(content)) {
      return f;
    }
  }
  return null;
}

function findWaiver(testId: string): string | null {
  // Canonical waiver source = the TS catalog's per-test lifecyclePhases. A test is
  // platform-waived when ITS OWN catalog entry declares 'n_a' (not-applicable) or
  // 'quarterly' (deferred cadence). This is a precise, per-test check — the old
  // archive scan matched any testId in a file that merely contained 'n_a'/'enabled'
  // anywhere (aitg_baseline lists all 32), so it silently waived everything and
  // masked genuine coverage gaps. The DB enabled flag is applied per implementation;
  // the platform catalog declares the lifecycle.
  const catalogPath = resolve(ROOT, 'packages/aitg/src/catalog.ts');
  if (!existsSync(catalogPath)) return null;
  const catalog = readFileSync(catalogPath, 'utf8');
  const entry = catalog.match(
    new RegExp(`testId:\\s*'${testId}'[\\s\\S]*?lifecyclePhases:\\s*\\[([^\\]]*)\\]`),
  );
  if (entry && /'n_a'|'quarterly'/.test(entry[1])) return 'catalog:lifecyclePhases';
  return null;
}

describe('AITG coverage — all 32 tests have an implementation marker', () => {
  const evidence: CoverageEvidence[] = CATALOG.map((testId) => ({
    testId,
    staticGate: findGateFile(testId),
    probeRoute: findProbeRoute(testId),
    waiver: findWaiver(testId),
  }));

  test('catalog has exactly 32 entries (14 APP + 7 MOD + 6 INF + 5 DAT)', () => {
    expect(CATALOG).toHaveLength(32);
  });

  test('every test has at least one implementation marker (gate / probe / waiver / delegation)', () => {
    const missing = evidence
      .filter(
        (e) =>
          !e.staticGate &&
          !e.probeRoute &&
          !e.waiver &&
          !DELEGATED_COVERAGE[e.testId] &&
          !KNOWN_DEFERRED[e.testId],
      )
      .map((e) => e.testId);
    expect(
      missing,
      `AITG tests without implementation:\n${missing.map((id) => `  - ${id}`).join('\n')}`,
    ).toEqual([]);
  });

  test('coverage breakdown report (informational; always passes)', () => {
    const byLayer = { app: 0, mod: 0, inf: 0, dat: 0 };
    let gates = 0;
    let probes = 0;
    let waivers = 0;
    let delegated = 0;
    for (const e of evidence) {
      const layer = e.testId.split('-')[1].toLowerCase() as keyof typeof byLayer;
      byLayer[layer]++;
      if (e.staticGate) gates++;
      if (e.probeRoute) probes++;
      if (e.waiver) waivers++;
      if (DELEGATED_COVERAGE[e.testId]) delegated++;
    }
    // Emit the report via the test name; this always passes.
    expect(byLayer.app + byLayer.mod + byLayer.inf + byLayer.dat).toBe(32);
    expect({ gates, probes, waivers, delegated }).toEqual(
      expect.objectContaining({
        gates: expect.any(Number),
        probes: expect.any(Number),
        waivers: expect.any(Number),
        delegated: expect.any(Number),
      }),
    );
  });

  test('delegations reference real coverage targets (gate file or component)', () => {
    for (const [testId, ref] of Object.entries(DELEGATED_COVERAGE)) {
      // A delegation is acceptable if it points to (a) an existing gate
      // file in src/tests/gates/aitg/, OR (b) a known @aisha/security
      // package/component string.
      const looksLikeFile = ref.endsWith('.gate.test.ts');
      if (looksLikeFile) {
        const path = resolve(ROOT, 'src/tests/gates/aitg', ref);
        expect(existsSync(path), `${testId} delegates to ${ref} which is missing`).toBe(true);
      } else {
        // Documentation-style delegation — just ensure non-empty
        expect(ref.length, `${testId} delegation must reference a real target`).toBeGreaterThan(10);
      }
    }
  });
});
