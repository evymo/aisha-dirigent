/**
 * Gate: every plugin ships a runnable test suite — and the runner can see it.
 *
 * WHY (measured 2026-07-26): moving vendor connectors from `services/` to
 * `plugins/` is what makes them genuinely optional — `plugins/` sits outside
 * the npm workspace globs, so an install that does not use a connector never
 * has to resolve it. The cost, unnoticed at the time, is that EVERY
 * workspace-shaped runner also stops seeing them: the root vitest config only
 * includes `src/**`, `test:services` walked only `services/`, and no CI job
 * mentioned `plugins/` at all. Result: `plugins/eurowag-telematics` shipped
 * with a unit suite that had never executed once, in CI or anywhere else, and
 * `plugins/partner-metrics` had no tests at all.
 *
 * A test that never runs is worth less than no test: it reads as coverage.
 *
 * This gate pins the three things that must hold together, so the same hole
 * cannot reopen:
 *   1. every plugin directory has a vitest config,
 *   2. every plugin has at least one test file,
 *   3. the aggregate runner actually discovers `plugins/` (a rename or a
 *      refactor of the runner that silently drops them fails HERE, not in
 *      six weeks when someone notices a connector was never tested).
 *
 * Deliberately no allowlist. A plugin with nothing worth testing is a plugin
 * with nothing worth shipping — write the test, or the plugin is not ready.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const RUNNER = path.join(ROOT, 'scripts/test/run-service-tests.mjs');

const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.mjs', 'vitest.config.js', 'vitest.config.cjs'];

function pluginDirs(): string[] {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR)
    .map((n) => path.join(PLUGINS_DIR, n))
    .filter((p) => statSync(p).isDirectory());
}

function hasTestFile(dir: string): boolean {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const entry of readdirSync(cur)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = path.join(cur, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (/\.(test|spec)\.ts$/.test(entry)) return true;
    }
  }
  return false;
}

describe('gate: plugin-has-tests', () => {
  const dirs = pluginDirs();

  it('there is at least one plugin to check (fixture sanity)', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs.map((d) => path.basename(d)))('plugin %s has a vitest config', (name) => {
    const dir = path.join(PLUGINS_DIR, name);
    const found = VITEST_CONFIGS.some((f) => existsSync(path.join(dir, f)));
    expect(
      found,
      `plugins/${name} has no vitest config — the aggregate runner discovers plugins BY that config, ` +
        `so without it the suite is invisible and silently never runs`,
    ).toBe(true);
  });

  it.each(dirs.map((d) => path.basename(d)))('plugin %s has at least one test file', (name) => {
    expect(
      hasTestFile(path.join(PLUGINS_DIR, name)),
      `plugins/${name} ships no *.test.ts / *.spec.ts. A vendor connector is exactly the code ` +
        `most likely to rot unnoticed: the vendor changes, nothing here fails, and the failure ` +
        `surfaces as missing data much later.`,
    ).toBe(true);
  });

  it('the aggregate runner discovers plugins/', () => {
    const src = readFileSync(RUNNER, 'utf8');
    expect(src, 'run-service-tests.mjs must resolve a plugins/ directory').toMatch(
      /PLUGINS_DIR\s*=\s*path\.join\(REPO_ROOT,\s*["']plugins["']\)/,
    );
    expect(src, 'run-service-tests.mjs must discover and run plugin suites').toMatch(/discoverPlugins\(\)/);
    expect(src, 'discovered plugin suites must actually be executed').toMatch(/runPluginTest\(/);
  });

  it('CI runs the aggregate runner on plugin changes', () => {
    const ci = readFileSync(path.join(ROOT, '.forgejo/workflows/ci.yml'), 'utf8');
    // The job that runs test:services is the one that now also covers plugins;
    // its change filter must therefore include plugins/, or a plugin-only PR
    // skips the job entirely and merges without ever running its tests.
    expect(ci, 'ci.yml must run the aggregate service+plugin runner').toMatch(/npm run test:services/);
    expect(ci, "ci.yml's change detection must treat plugins/ as a services-lane change").toMatch(
      /plugins\//,
    );
  });
});
