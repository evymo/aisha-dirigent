/**
 * Static defense-in-depth umbrella gate
 *
 * After OWASP Top 10 + AITG 32/32 are 100% covered, this gate enforces
 * that the FOUR independent static analysis layers stay wired:
 *
 *   1. SBOM coverage (Phase 1)  — supply-chain transparency per service
 *   2. Semgrep SAST (Phase 2)   — AST-based pattern detection in CI
 *   3. ESLint security plugins (Phase 3)  — lint-time security rules
 *   4. TS strict mode (Phase 4) — compile-time type guarantees
 *
 * Why an umbrella gate: each individual gate enforces ITS layer's
 * integrity. But a malicious or accidental PR could delete ALL four
 * gate files at once and the suite would shrink without obvious signal
 * (we'd just see fewer tests passing). This gate fails the PR that
 * removes any of the four layer gates — which would silently weaken the
 * platform's defense surface.
 *
 * Per the no-workarounds principle: this gate is INTENTIONALLY redundant
 * with the individual gates. The redundancy IS the value — it catches
 * the case where someone (or some AI agent) decides to "simplify" by
 * removing what looks like duplication.
 *
 * Adding a 5th defense layer: add an entry to LAYERS array, write the
 * implementing gate file, then run this gate to verify the new layer
 * is detectable.
 */

import { describe, test, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  SNAPSHOT_EXCLUDE,
  duvodVynechanoSnapshotem,
  vyrazenoVzorem,
  vzorySnapshotu,
} from './lib/vynechano-snapshotem';

const ROOT = process.cwd();

interface DefenseLayer {
  id: string;
  description: string;
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  /** The gate file that enforces this layer's integrity. */
  gateFile: string;
  /** Supporting artifact files this layer depends on. */
  artifacts: string[];
}

const LAYERS: DefenseLayer[] = [
  {
    id: 'sbom-coverage',
    description: 'CycloneDX SBOM generated per service + attached as cosign attestation',
    phase: 1,
    gateFile: 'src/tests/gates/sbom-coverage.gate.test.ts',
    artifacts: [
      '.forgejo/workflows/ci.yml',
      '.github/workflows/container-signing.yml',
    ],
  },
  {
    id: 'semgrep-sast',
    description: 'Semgrep AST-based static analysis on every PR + nightly',
    phase: 2,
    gateFile: 'src/tests/gates/semgrep-sast.gate.test.ts',
    artifacts: [
      '.forgejo/workflows/ci.yml',
      '.semgrep/aisha-rules.yml',
    ],
  },
  {
    id: 'eslint-security',
    description: 'eslint-plugin-security + eslint-plugin-no-secrets with stratified severity',
    phase: 3,
    gateFile: 'src/tests/gates/eslint-security-coverage.gate.test.ts',
    artifacts: [
      'eslint.config.js',
    ],
  },
  {
    id: 'tsconfig-strict',
    description: 'TS strict mode required for every package/* and service/* tsconfig',
    phase: 4,
    gateFile: 'src/tests/gates/tsconfig-strict-coverage.gate.test.ts',
    artifacts: [
      // No additional artifacts — strict lives in each tsconfig
    ],
  },
  {
    id: 'static-defense-generator',
    description: 'DB-as-SoT for Semgrep + ESLint policy rules, generated to repo files',
    phase: 5,
    gateFile: 'src/tests/gates/static-defense-generator-integrity.gate.test.ts',
    artifacts: [
      'aisha/db/migrations/00000000000000_baseline.sql',
      'aisha/db/sql/tables/aisha_static_defense_rules.sql',
      'aisha/db/sql/functions/aisha_get_active_static_defense_rules.sql',
      'scripts/gen-static-defense.mjs',
      // Note: `.aisha/static-defense-payload.json` was previously listed
      // here, but `.aisha/` is generated-workspace territory (see project
      // rule `feedback_aisha_dir_is_generated`) and the payload cache is
      // local-only. CI bootstraps the payload from the seed migration via
      // the generator's `--from-seed` flag instead.
    ],
  },
  {
    id: 'static-defense-write-rpcs',
    description: 'Aisha-autonomous + operator-UI propose/publish/deprecate RPCs (write side)',
    phase: 6,
    gateFile: 'src/tests/gates/static-defense-write-rpcs.gate.test.ts',
    artifacts: [
      'aisha/db/migrations/00000000000000_baseline.sql',
      'aisha/db/sql/functions/aisha_propose_static_defense_rule.sql',
      'aisha/db/sql/functions/aisha_publish_static_defense_rule.sql',
      'aisha/db/sql/functions/aisha_deprecate_static_defense_rule.sql',
    ],
  },
  {
    id: 'service-typecheck-baseline',
    description: 'Monotone-decreasing implicit-any baseline per service (Phase 4 enforcement)',
    phase: 7,
    gateFile: 'src/tests/gates/service-typecheck-baseline.gate.test.ts',
    artifacts: [
      'src/tests/gates/service-typecheck-baseline.json',
      'scripts/gen-service-typecheck-baseline.mjs',
    ],
  },
  {
    id: 'frontend-typecheck-baseline',
    description: 'Monotone-decreasing strict-mode debt baseline for the Vite frontend',
    phase: 8,
    gateFile: 'src/tests/gates/frontend-typecheck-baseline.gate.test.ts',
    artifacts: [
      'tsconfig.strict.json',
      'src/tests/gates/frontend-typecheck-baseline.json',
      'scripts/gen-frontend-typecheck-baseline.mjs',
    ],
  },
  {
    id: 'coverage-thresholds',
    description: 'Test coverage thresholds locked at ≥80% across lines/functions/branches/statements',
    phase: 9,
    gateFile: 'src/tests/gates/coverage-thresholds.gate.test.ts',
    artifacts: [
      'vitest.config.ts',
    ],
  },
  {
    id: 'static-defense-committer-flow',
    description: 'Aisha-autonomous commit-back loop: DB publish → n8n webhook → Forgejo branch + YAML regen + auto-PR',
    phase: 10,
    gateFile: 'src/tests/gates/static-defense-committer-flow.gate.test.ts',
    artifacts: [
      'n8n/workflows/WF_STATIC_DEFENSE_COMMITTER.json',
    ],
  },
];

describe('Static defense-in-depth umbrella gate', () => {
  test('exactly 10 defense layers are registered', () => {
    // Tripwire — if an 11th layer is added (or one removed), this
    // forces an explicit decision rather than silent drift.
    expect(LAYERS).toHaveLength(10);
  });

  test('every layer has phase 1-10 assigned', () => {
    const phases = LAYERS.map((l) => l.phase).sort((a, b) => a - b);
    expect(phases).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('every layer\'s gate file exists', () => {
    const missing: string[] = [];
    for (const layer of LAYERS) {
      const fullPath = resolve(ROOT, layer.gateFile);
      if (!existsSync(fullPath)) {
        missing.push(`${layer.id} → ${layer.gateFile}`);
      }
    }
    expect(
      missing,
      `Defense layer gate files missing: ${missing.join(', ')}. This is a regression — removing a layer gate silently weakens the platform.`,
    ).toEqual([]);
  });

  // Artefakty, které veřejný snapshot nevozí (config/public-snapshot.exclude):
  // měří je samostatný test níž — v upstreamu je ověří, ve veřejném klonu se
  // PŘESKOČÍ s důvodem. Viz lib/vynechano-snapshotem.
  const vzory = existsSync(resolve(ROOT, SNAPSHOT_EXCLUDE))
    ? vzorySnapshotu(readFileSync(resolve(ROOT, SNAPSHOT_EXCLUDE), 'utf8'))
    : [];
  const mimoSnapshot = LAYERS.flatMap((layer) =>
    layer.artifacts.filter((a) => vyrazenoVzorem(a, vzory)).map((a) => ({ layer: layer.id, artifact: a })),
  );
  const nezmereno = mimoSnapshot
    .map(({ artifact }) => duvodVynechanoSnapshotem(artifact))
    .filter((d): d is string => d !== null);

  test.skipIf(nezmereno.length > 0)(
    `artefakty vrstev mimo veřejný snapshot existují${nezmereno.length ? ` — NEZMĚŘENO: ${nezmereno.join('; ')}` : ''}`,
    () => {
      const missing = mimoSnapshot.filter(({ artifact }) => !existsSync(resolve(ROOT, artifact)));
      expect(missing.map(({ layer, artifact }) => `${layer} → ${artifact}`)).toEqual([]);
    },
  );

  test('every layer\'s supporting artifacts exist', () => {
    const missing: string[] = [];
    for (const layer of LAYERS) {
      for (const artifact of layer.artifacts) {
        if (vyrazenoVzorem(artifact, vzory)) continue; // měří test výš
        const fullPath = resolve(ROOT, artifact);
        if (!existsSync(fullPath)) {
          missing.push(`${layer.id} → ${artifact}`);
        }
      }
    }
    expect(
      missing,
      `Defense layer artifacts missing: ${missing.join(', ')}. These files are required for the layer to function.`,
    ).toEqual([]);
  });

  test('layer descriptions are substantive (≥30 chars, not one-word labels)', () => {
    for (const layer of LAYERS) {
      expect(
        layer.description.length,
        `Layer "${layer.id}" description too short — must explain what is enforced`,
      ).toBeGreaterThanOrEqual(30);
    }
  });

  test('full defense matrix: OWASP + AITG + 4 static layers', () => {
    // Sanity check that the 4 layers reference distinct OWASP/AITG categories
    // (no double-counting). Each layer attacks the platform's security
    // surface from a different angle:
    //   - SBOM: A06 (vuln components) + A08 (data integrity)
    //   - Semgrep: A03 (injection) + A05 (misconfig) + A09 (logging) + A10 (SSRF) + AITG-APP-01
    //   - ESLint: A02 (crypto) + A09 (logging) + A10 (SSRF)
    //   - TS strict: A03 (type-safety as injection defense) + implicit any catches
    //
    // This is informational — the assertion is that 4 distinct layer ids exist.
    const ids = new Set(LAYERS.map((l) => l.id));
    expect(ids.size).toBe(LAYERS.length);
  });

  test('negativní sonda: vyřazení snapshotem — adresář i přesná cesta ano, glob a cizí cesta ne; tři odpovědi', () => {
    const vzory = vzorySnapshotu('# komentář\n.github/workflows/\n.github/dependabot.yml\n\nfoo/*.yml\n');
    expect(vzory).toEqual(['.github/workflows/', '.github/dependabot.yml', 'foo/*.yml']);
    expect(vyrazenoVzorem('.github/workflows/deploy.yml', vzory)).toBe(true);
    expect(vyrazenoVzorem('.github/workflows', vzory)).toBe(true);
    expect(vyrazenoVzorem('.github/workflows/', vzory)).toBe(true);
    expect(vyrazenoVzorem('.github/dependabot.yml', vzory)).toBe(true);
    expect(vyrazenoVzorem('.github/workflowsX/a.yml', vzory)).toBe(false);
    expect(vyrazenoVzorem('foo/a.yml', vzory)).toBe(false); // glob se NEvykládá → brána padá, nemlčí
    expect(vyrazenoVzorem('.forgejo/workflows/ci.yml', vzory)).toBe(false);

    const koren = mkdtempSync(join(tmpdir(), 'snapshot-sonda-'));
    try {
      mkdirSync(join(koren, 'config'), { recursive: true });
      writeFileSync(join(koren, SNAPSHOT_EXCLUDE), '.github/workflows/\n');
      mkdirSync(join(koren, '.forgejo/workflows'), { recursive: true });
      writeFileSync(join(koren, '.forgejo/workflows/ci.yml'), 'on: push\n');
      // soubor je → měří se
      expect(duvodVynechanoSnapshotem('.forgejo/workflows/ci.yml', koren)).toBeNull();
      // chybí a snapshot ho vyřazuje → důvod pro skip
      expect(duvodVynechanoSnapshotem('.github/workflows/deploy.yml', koren)).toMatch(/veřejný snapshot nevozí/);
      // chybí BEZ důvodu → null, brána má padnout
      expect(duvodVynechanoSnapshotem('.forgejo/workflows/deploy.yml', koren)).toBeNull();
    } finally {
      rmSync(koren, { recursive: true, force: true });
    }
  });
});
