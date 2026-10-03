/**
 * ESLint security coverage gate — defense-in-depth Layer 3
 *
 * Validates that the eslint.config.js wires eslint-plugin-security and
 * eslint-plugin-no-secrets correctly, and that the stratified rule
 * tiering (HTTP entrypoints → ERROR, other code → WARN) stays in place.
 *
 * Why static, not runtime: ESLint itself runs in CI. This gate enforces
 * the integration surface — a future commit deleting the plugin or
 * downgrading every rule to "off" would silently drop a defense layer.
 * Per the no-workarounds principle, that drift must be caught in PR
 * review, not weeks later when CI quietly stops checking.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const ESLINT_CONFIG = resolve(ROOT, 'eslint.config.js');
const PACKAGE_JSON = resolve(ROOT, 'package.json');

const REQUIRED_PLUGINS = [
  'eslint-plugin-security',
  'eslint-plugin-no-secrets',
];

// Rules that must NEVER be downgraded from ERROR — unambiguous bugs.
const ALWAYS_ERROR_RULES = [
  'security/detect-buffer-noassert',
  'security/detect-eval-with-expression',
  'security/detect-pseudoRandomBytes',
  'security/detect-disable-mustache-escape',
  'no-secrets/no-secrets',
];

// Rules that ESLint reports as WARN at base but must be promoted to
// ERROR on the HTTP entrypoint hot path.
const HOT_PATH_PROMOTED_RULES = [
  'security/detect-non-literal-fs-filename',
  'security/detect-non-literal-regexp',
  'security/detect-unsafe-regex',
  'security/detect-child-process',
  'security/detect-possible-timing-attacks',
];

describe('ESLint security coverage gate', () => {
  test('eslint.config.js exists', () => {
    expect(existsSync(ESLINT_CONFIG)).toBe(true);
  });

  test('both required plugins are installed', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    for (const plugin of REQUIRED_PLUGINS) {
      expect(
        allDeps[plugin],
        `${plugin} must be declared as a dev dependency`,
      ).toBeDefined();
    }
  });

  test('eslint.config.js imports + registers both plugins', () => {
    const content = readFileSync(ESLINT_CONFIG, 'utf8');
    expect(content).toMatch(/from\s+["']eslint-plugin-security["']/);
    expect(content).toMatch(/from\s+["']eslint-plugin-no-secrets["']/);
    expect(content).toMatch(/["']security["']\s*:\s*security/);
    expect(content).toMatch(/["']no-secrets["']\s*:\s*noSecrets/);
  });

  test('always-error rules are NOT downgraded', () => {
    const content = readFileSync(ESLINT_CONFIG, 'utf8');
    for (const rule of ALWAYS_ERROR_RULES) {
      // Rule must appear with severity "error" or as an array starting "error"
      const escaped = rule.replace(/\//g, '\\/');
      const errorPattern = new RegExp(`["']${escaped}["']\\s*:\\s*(?:["']error["']|\\[["']error["'])`);
      expect(
        errorPattern.test(content),
        `Rule "${rule}" must be configured as "error" (unambiguous security bug, never warn/off)`,
      ).toBe(true);
    }
  });

  test('HTTP entrypoint override block exists and promotes rules to error', () => {
    const content = readFileSync(ESLINT_CONFIG, 'utf8');
    // The hot-path block must include services/*/src/routes
    expect(content).toMatch(/services\/\*\/src\/routes\/\*\*/);
    // And it must explicitly upgrade the listed rules to error
    for (const rule of HOT_PATH_PROMOTED_RULES) {
      const escaped = rule.replace(/\//g, '\\/');
      // Look for the rule promoted to error anywhere in the override block
      // (we don't try to be precise about block boundaries; presence + error severity is sufficient)
      const promoted = new RegExp(`["']${escaped}["']\\s*:\\s*["']error["']`);
      expect(
        promoted.test(content),
        `Hot-path override must promote "${rule}" to error severity`,
      ).toBe(true);
    }
  });

  test('test exemption block does not turn off ALWAYS_ERROR rules', () => {
    const content = readFileSync(ESLINT_CONFIG, 'utf8');
    // Search the test-files override block for any of the always-error rules
    // turned off. Allowing them off in tests would let real bugs hide.
    // Block boundary: line containing "Test + tooling files" through to
    // closing brace before final `);`.
    const testBlockMatch = content.match(/Test \+ tooling files[\s\S]*?(?=\n {2}\},)/);
    expect(testBlockMatch, 'test exemption block must exist').not.toBeNull();
    const testBlock = testBlockMatch![0];
    for (const rule of ALWAYS_ERROR_RULES) {
      const escaped = rule.replace(/\//g, '\\/');
      const offPattern = new RegExp(`["']${escaped}["']\\s*:\\s*["']off["']`);
      if (rule === 'no-secrets/no-secrets') {
        // no-secrets is legitimately off in tests (fixture JWTs)
        continue;
      }
      expect(
        offPattern.test(testBlock),
        `Test exemption block must NOT turn off "${rule}" — it's an unambiguous bug class even in test code`,
      ).toBe(false);
    }
  });

  test('no-secrets rule lists AISHA-relevant additional regexes', () => {
    const content = readFileSync(ESLINT_CONFIG, 'utf8');
    // We require detection of OpenAI-style keys (sk-), Anthropic keys
    // (sk-ant-), AWS access keys (AKIA*), and GitHub PATs (ghp_*)
    expect(content).toMatch(/aws-access-key/);
    expect(content).toMatch(/github-pat/);
    expect(content).toMatch(/openai-key/);
    expect(content).toMatch(/anthropic-key/);
  });
});
