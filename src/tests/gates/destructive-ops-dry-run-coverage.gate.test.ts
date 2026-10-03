/**
 * Gate test: destructive-ops-dry-run-coverage
 *
 * Wires `scripts/audit/destructive-ops-survey.mjs` into the pre-push hook.
 * Asserts the count of UNGUARDED destructive operations stays at-or-below
 * the ratchet baseline.
 *
 * What this catches:
 *   - Any new `coolify_api DELETE` / `docker rm -f` / `rm -rf <non-/tmp>`
 *     / `git push --force` etc. added to a script without a DRY_RUN guard
 *   - Regression of the 2026-05-26 incident (cold-start --wipe --dry-run
 *     actually wiped 15/16 apps) — that bug is locked-in by
 *     cold-start-dry-run-safety.gate.test.ts, but THIS gate catches the
 *     PATTERN across the whole repo
 *
 * Mechanism: shells out to the survey script (`--json` mode) and parses
 * the UNGUARDED count. The script's own heuristic recognises three guard
 * shapes (direct DRY_RUN check, else-branch, early-return).
 *
 * Ratchet baseline: `destructive-ops-survey.baseline.json` —
 *   `unguarded_count: N`. Update DOWNWARD as cleanup PRs land. Failing
 *   means a NEW unguarded op was introduced.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SURVEY_SCRIPT = join(ROOT, 'scripts/audit/destructive-ops-survey.mjs');
const BASELINE_PATH = join(ROOT, 'src/tests/gates/destructive-ops-survey.baseline.json');

interface Baseline {
  unguarded_count: number;
  _comment?: string;
}

function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

interface SurveyOutput {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  findings: Array<{
    file: string;
    line: number;
    patternId: string;
    category: string;
    hint: string;
    snippet: string;
    status: 'UNGUARDED' | 'PROTECTED' | 'ALLOWLIST';
  }>;
}

describe('destructive-ops-dry-run-coverage — every destructive op must be DRY_RUN-gated', () => {
  it('survey script exists', () => {
    expect(existsSync(SURVEY_SCRIPT), `${SURVEY_SCRIPT} not found`).toBe(true);
  });

  it('baseline file exists with `unguarded_count`', () => {
    expect(existsSync(BASELINE_PATH), `${BASELINE_PATH} not found`).toBe(true);
    const b = loadBaseline();
    expect(typeof b.unguarded_count).toBe('number');
    expect(b.unguarded_count).toBeGreaterThanOrEqual(0);
  });

  it('UNGUARDED count stays at-or-below baseline (no regression)', () => {
    // execFileSync — no shell, no injection surface
    const raw = execFileSync('node', [SURVEY_SCRIPT, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    let survey: SurveyOutput;
    try {
      survey = JSON.parse(raw) as SurveyOutput;
    } catch (err) {
      throw new Error(
        `Failed to parse survey JSON output: ${(err as Error).message}\nFirst 500 chars: ${raw.slice(0, 500)}`,
      );
    }
    const baseline = loadBaseline();
    const current = survey.byStatus.UNGUARDED ?? 0;

    if (current > baseline.unguarded_count) {
      const newOnes = survey.findings.filter((f) => f.status === 'UNGUARDED');
      const sample = newOnes.slice(0, 15).map(
        (f) => `  [${f.category}] ${f.file}:${f.line} — ${f.hint}\n    ${f.snippet}`,
      );
      throw new Error(
        `Destructive-op regression: baseline=${baseline.unguarded_count}, current=${current}. ` +
          `A new destructive operation was added without a DRY_RUN guard. Either:\n` +
          `  (a) wrap it: \`if [ "$DRY_RUN" = "1" ]; then echo "[DRY RUN] ..."; else <op>; fi\`\n` +
          `  (b) explicitly mark the entire script as destructive-by-purpose in EXPLICIT_DESTRUCTIVE_SCRIPTS\n` +
          `      (in scripts/audit/destructive-ops-survey.mjs)\n\n` +
          `Findings sample (first 15 of ${newOnes.length}):\n${sample.join('\n')}`,
      );
    }
    // Pass if at or below baseline — gate ratchets DOWN with each cleanup PR
    expect(current).toBeLessThanOrEqual(baseline.unguarded_count);
  });
});
