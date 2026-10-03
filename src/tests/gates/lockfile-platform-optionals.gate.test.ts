/**
 * Gate test: lockfile-platform-optionals
 *
 * Locks the invariant that package-lock.json records a full `node_modules/...`
 * entry for EVERY platform-native optional dependency (rollup, swc, esbuild,
 * lightningcss, sharp, ... binaries per os/cpu/libc), not just the platform
 * the lockfile was last touched on.
 *
 * Background: 2026-06-11 cold-start — `vite build` inside Dockerfile.web on
 * node:22-alpine (linux-x64-musl) failed with `Cannot find module
 * '@rollup/rollup-linux-x64-musl'`. The lockfile carried ONLY
 * `@rollup/rollup-darwin-arm64` (and `@swc/core-darwin-arm64`): an earlier
 * incremental `npm install` on macOS recorded just the local platform's
 * binary, so `npm ci` on Alpine had nothing to install (npm/cli#4828 class).
 * Local dev (darwin) stayed green — the gap only detonated in Docker builds.
 *
 * The invariant: for every lockfile package whose `optionalDependencies` are
 * platform-binary-shaped (name encodes os/arch/libc), each such optional MUST
 * have its own entry under `packages`. Repair when this fires:
 *
 *   1. delete the affected subtree entries from package-lock.json
 *      (the parent + its platform siblings), then
 *   2. `npm install --package-lock-only` regenerates them for ALL platforms.
 *
 * Run via: `npm run test:gates`
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOCKFILE = join(ROOT, 'package-lock.json');

// Platform-binary package names encode an OS token plus an arch token —
// e.g. @rollup/rollup-linux-x64-musl, @swc/core-darwin-arm64,
// @esbuild/win32-x64, lightningcss-linux-arm64-gnu.
const OS_TOKEN = /(linux|darwin|win32|android|freebsd|openbsd|openharmony|aix|sunos)/;
const ARCH_TOKEN = /(x64|arm64|ia32|arm|riscv64|s390x|ppc64|loong64|mips64el)/;
const isPlatformBinaryName = (name: string) =>
  OS_TOKEN.test(name) && ARCH_TOKEN.test(name);

type LockPackage = {
  optionalDependencies?: Record<string, string>;
};
type Lockfile = { packages: Record<string, LockPackage> };

describe('lockfile-platform-optionals — npm ci must work on every deploy platform', () => {
  const lock: Lockfile = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
  const rootPkg: { workspaces?: string[] | { packages?: string[] } } = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  );
  const packages = lock.packages ?? {};

  // Collect every platform-binary optional declared by any locked package,
  // remembering which parent declared it (for actionable failure output).
  const declared = new Map<string, string[]>(); // optional pkg name -> parents
  for (const [path, meta] of Object.entries(packages)) {
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) {
      if (!isPlatformBinaryName(dep)) continue;
      const parents = declared.get(dep) ?? [];
      parents.push(path || '(root)');
      declared.set(dep, parents);
    }
  }

  it('sanity: lockfile declares platform-binary optionals (rollup/esbuild/swc expected)', () => {
    // If this ever goes to zero the detection regex rotted — fix the gate.
    expect(declared.size, 'no platform-binary optionalDependencies detected in lockfile').toBeGreaterThan(0);
  });

  it('every declared platform-binary optional has its own packages entry', () => {
    const missing: string[] = [];
    for (const [dep, parents] of declared) {
      if (!packages[`node_modules/${dep}`]) {
        missing.push(`${dep} (declared by: ${[...new Set(parents)].join(', ')})`);
      }
    }
    expect(
      missing,
      [
        'package-lock.json is missing entries for platform-native binaries —',
        '`npm ci` will fail on platforms other than the one that last wrote the lockfile',
        '(e.g. Docker builds on node:*-alpine). Repair: delete the parent package',
        'and its platform-sibling entries from package-lock.json, then run',
        '`npm install --package-lock-only` to re-record ALL platforms. Missing:',
        ...missing.map((m) => `  - ${m}`),
      ].join('\n'),
    ).toEqual([]);
  });

  /**
   * Every workspace the root package.json globs in must exist in the lockfile.
   *
   * Measured 2026-07-27: apps/mobile-shell, apps/workbench-shell and
   * packages/surface-blocks were matched by the `apps/*` / `packages/*` globs but
   * absent from package-lock.json, so CI died at `npm ci` with a wall of
   * "Missing: @esbuild/linux-*@0.21.5 from lock file" — a message that points at
   * esbuild while the actual hole is an unregistered workspace. The platform
   * checks above cannot see this: the optionals they inspect are the ones the
   * lockfile already knows about.
   */
  it('every workspace matched by the root globs is registered in the lockfile', () => {
    const globs: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces?.packages ?? []);
    expect(globs.length, 'root package.json declares no workspaces — harness broken').toBeGreaterThan(0);

    const declared: string[] = [];
    for (const glob of globs) {
      const dir = glob.replace(/\/\*$/, '');
      const base = join(ROOT, dir);
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        const ws = `${dir}/${entry}`;
        if (existsSync(join(ROOT, ws, 'package.json'))) declared.push(ws);
      }
    }

    const missing = declared.filter((ws) => !lock.packages?.[ws]);
    expect(
      missing,
      'these workspaces exist on disk and are globbed in by package.json, but the lockfile ' +
        'has no entry for them — `npm ci` will fail on their transitive deps. Fix with ' +
        '`npm install --package-lock-only` (a plain install on macOS drops the Linux ' +
        'platform binaries the checks above guard).',
    ).toEqual([]);
  });

  it('deploy-critical musl binaries are present (Dockerfile.web builds on alpine)', () => {
    // The web image builds with vite (rollup) + @vitejs/plugin-react-swc
    // (@swc/core) on node:22-alpine — linux-x64-musl is the one platform a
    // macOS/CI-linux-gnu dev loop never exercises. Pin it explicitly so the
    // failure message names the exact deploy-blocking gap.
    for (const dep of ['@rollup/rollup-linux-x64-musl', '@swc/core-linux-x64-musl']) {
      expect(
        packages[`node_modules/${dep}`],
        `${dep} missing from package-lock.json — the alpine web build (Dockerfile.web) cannot install it`,
      ).toBeDefined();
    }
  });
});
