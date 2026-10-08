/**
 * Semgrep SAST integrity gate — defense-in-depth Layer 2
 *
 * Validates that the Semgrep workflow + rules YAML stay wired:
 *   - Workflow file exists and runs on pull_request
 *   - Rules YAML exists and uses canonical Semgrep schema
 *   - Workflow consumes every layer (OWASP + secrets + AISHA-local)
 *   - At least N AISHA-local rules covering OWASP categories
 *   - Every AISHA-local rule has severity ERROR (not just WARNING)
 *
 * This gate is the PR-time enforcement for the Semgrep job — if a future
 * commit deletes the workflow or strips out the AISHA rules layer, this
 * fails the PR. Per the no-workarounds principle, you can't silently
 * weaken SAST coverage.
 *
 * Note: this gate does NOT run Semgrep itself (that's the workflow's job).
 * It only verifies the integration surface. The actual rule firing happens
 * in CI against the PR's diff.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
// CI/CD runs on GitHub Actions (.github/workflows/). The SAST job lives in
// ci.yml (folded in 2026-05-30, content unchanged), so every integrity
// assertion below still enforces the full ruleset.
const SEMGREP_WORKFLOW = resolve(ROOT, '.github/workflows/ci.yml');
const SEMGREP_RULES = resolve(ROOT, '.semgrep/aisha-rules.yml');

const REQUIRED_REGISTRY_RULES = [
  'p/owasp-top-ten', // OWASP Top 10 community ruleset
  'p/typescript', // TS-specific patterns
  'p/javascript', // JS-specific patterns
  'p/secrets', // embedded credentials
  'p/insecure-transport', // plain HTTP / insecure protocols
];

const REQUIRED_AISHA_RULE_IDS = [
  'aisha-raw-fetch-outside-ssrf-guard', // A10
  'aisha-console-in-service-runtime', // A09
  'aisha-inline-jose-jwt-verify', // A07
  'aisha-fastify-route-without-zod', // A03
  'aisha-hardcoded-secret-fallback', // A02
  'aitg-llm-import-without-guard', // AITG-APP-01
];

describe('Semgrep SAST integrity gate', () => {
  test('semgrep-sast workflow file exists', () => {
    expect(existsSync(SEMGREP_WORKFLOW)).toBe(true);
  });

  test('aisha-rules.yml file exists', () => {
    expect(existsSync(SEMGREP_RULES)).toBe(true);
  });

  test('workflow runs on every PR (not just nightly)', () => {
    const content = readFileSync(SEMGREP_WORKFLOW, 'utf8');
    expect(content).toMatch(/^\s*pull_request:\s*$/m);
  });

  test('workflow pins Semgrep image to specific version (no :latest)', () => {
    const content = readFileSync(SEMGREP_WORKFLOW, 'utf8');
    // Match the pinned Semgrep image wherever it is referenced — as a job
    // `container: image:` OR on a `docker run semgrep/semgrep:<ver>` line
    // (the latter form exists for container-based runners that can't run JS
    // actions inside a job container). Spec unchanged: a pinned semgrep/semgrep
    // image must be used, and `:latest` is rejected below.
    const imageMatch = content.match(/semgrep\/semgrep:([^\s"'\\]+)/);
    expect(imageMatch, 'workflow must use a pinned semgrep/semgrep image').not.toBeNull();
    // Reject :latest — reproducibility requires a pinned tag
    expect(imageMatch![1]).not.toMatch(/^latest$/);
    // Reject empty / wildcard
    expect(imageMatch![1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('workflow consumes every required ruleset layer', () => {
    const content = readFileSync(SEMGREP_WORKFLOW, 'utf8');
    for (const ruleset of REQUIRED_REGISTRY_RULES) {
      expect(
        content,
        `workflow must --config "${ruleset}" for defense-in-depth coverage`,
      ).toContain(ruleset);
    }
  });

  test('workflow consumes local AISHA rules YAML', () => {
    const content = readFileSync(SEMGREP_WORKFLOW, 'utf8');
    expect(content).toMatch(/\.semgrep\/aisha-rules\.yml/);
  });

  test('workflow fails CI on ERROR-severity findings (not just reports)', () => {
    const content = readFileSync(SEMGREP_WORKFLOW, 'utf8');
    // Either --severity ERROR + --error, or --severity ERROR with implicit fail
    expect(content).toMatch(/--severity\s+ERROR/);
    expect(content).toMatch(/--error/);
  });

  test('AISHA rules YAML declares every required rule id', () => {
    const content = readFileSync(SEMGREP_RULES, 'utf8');
    for (const ruleId of REQUIRED_AISHA_RULE_IDS) {
      expect(
        content,
        `local Semgrep rules must include rule id "${ruleId}" (defense-in-depth for the matching gate)`,
      ).toContain(`id: ${ruleId}`);
    }
  });

  test('every AISHA rule has severity ERROR (no soft warnings for security-critical patterns)', () => {
    const content = readFileSync(SEMGREP_RULES, 'utf8');
    // Find every `id: X` block and check it has `severity: ERROR` before the next `- id:` or EOF
    const idMatches = Array.from(content.matchAll(/^\s*-\s*id:\s*([^\s]+)/gm));
    for (let i = 0; i < idMatches.length; i++) {
      const m = idMatches[i];
      const ruleId = m[1];
      const blockStart = m.index!;
      const blockEnd = idMatches[i + 1]?.index ?? content.length;
      const block = content.slice(blockStart, blockEnd);
      expect(
        block,
        `Semgrep rule "${ruleId}" must declare severity: ERROR (security rules are blocking, not advisory)`,
      ).toMatch(/severity:\s*ERROR/);
    }
  });

  test('no workflow-injection surface in semgrep workflow', () => {
    const content = readFileSync(SEMGREP_WORKFLOW, 'utf8');
    // No `${{ github.event.* }}` references inside run: steps (which would
    // be exploitable). Container.image is fine because it's a constant.
    const runBlocks = Array.from(content.matchAll(/^\s+run:\s*\|?\s*\n([\s\S]*?)(?=^\s+\w+:|^\s*$)/gm));
    for (const block of runBlocks) {
      const body = block[1];
      const interpolations = body.match(/\$\{\{[^}]+\}\}/g);
      if (interpolations) {
        // Only constants like steps.x.outputs (output of trusted step) are
        // acceptable; github.event.* is not.
        for (const interp of interpolations) {
          expect(
            interp,
            `Workflow injection risk: \`${interp}\` interpolated into run: block. Use env: block instead.`,
          ).not.toMatch(/github\.event\.(issue|pull_request|comment|review)/);
        }
      }
    }
  });
});
