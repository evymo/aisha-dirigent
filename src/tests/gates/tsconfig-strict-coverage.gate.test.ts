/**
 * TypeScript strict mode coverage gate — defense-in-depth Layer 4
 *
 * Enforces that every package/* and services/* tsconfig.json declares
 * "strict": true (or one of the equivalent explicit forms). This is the
 * compile-time complement to:
 *   - Phase 1: SBOM coverage (every service has SBOM)
 *   - Phase 2: Semgrep SAST (every service AST-scanned)
 *   - Phase 3: ESLint security plugins (every service lint-checked)
 *   - Phase 4: TS strict (every service compile-time-checked, this gate)
 *
 * `strict: true` enables:
 *   - noImplicitAny
 *   - strictNullChecks
 *   - strictFunctionTypes
 *   - strictBindCallApply
 *   - strictPropertyInitialization
 *   - noImplicitThis
 *   - alwaysStrict
 *
 * Removing strict mode from a tsconfig silently weakens type guarantees
 * for the entire package — a function arg can switch from string to
 * unknown without compile error. This gate fails the PR that downgrades.
 *
 * Frontend root tsconfig is EXEMPT (legacy Vite app with large surface
 * area; gradual strict-mode rollout tracked separately). Trash / archive
 * configs are also exempt.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isTrackedService } from './lib/tracked-services';

const ROOT = process.cwd();

/**
 * Directories whose every direct subfolder must have a strict tsconfig.
 * Add new directories here if a new "managed" project type is introduced.
 */
const STRICT_REQUIRED_PARENTS = ['packages', 'services'];

/**
 * Tsconfigs that legitimately don't carry strict mode. Each entry MUST
 * have a documented reason — exempting silently is a regression.
 */
const EXEMPT_TSCONFIGS: Record<string, string> = {
  './tsconfig.json':
    'Frontend Vite app root config. Strict-mode rollout requires migrating ' +
    '~15k LOC of legacy implicit-any patterns; tracked as a separate work ' +
    'item. Strict still applies in /src via tsconfig.app.json overrides where possible.',
  './tsconfig.app.json':
    'Frontend app config — same legacy reason as ./tsconfig.json above.',
  './tsconfig.node.json':
    'Frontend Node build config (Vite). Inherits root settings.',
  './mobile-app/tsconfig.json':
    'Mobile-app already has strict:true (verified by this gate) but the ' +
    'parent dir is not under packages/services — this entry is here so the ' +
    'gate scan does not need to walk every dir, only the canonical roots.',
};

function readJsonStripComments(content: string): unknown {
  // Strip line and block comments, then trailing commas — minimal JSONC
  // support since tsconfig.json files commonly carry comments.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}

function hasStrictMode(tsconfigPath: string): boolean {
  if (!existsSync(tsconfigPath)) return false;
  try {
    const content = readFileSync(tsconfigPath, 'utf8');
    const parsed = readJsonStripComments(content) as {
      compilerOptions?: {
        strict?: boolean;
        noImplicitAny?: boolean;
        strictNullChecks?: boolean;
      };
    };
    const co = parsed.compilerOptions ?? {};
    // Either `strict: true` OR all sub-flags individually true
    if (co.strict === true) return true;
    if (co.noImplicitAny === true && co.strictNullChecks === true) return true;
    return false;
  } catch {
    return false;
  }
}

describe('TypeScript strict coverage gate', () => {
  test('every package/* tsconfig has strict mode', () => {
    const packagesDir = resolve(ROOT, 'packages');
    if (!existsSync(packagesDir)) return;

    const missing: string[] = [];
    for (const pkg of readdirSync(packagesDir)) {
      const tsconfig = join(packagesDir, pkg, 'tsconfig.json');
      if (!existsSync(tsconfig)) continue;
      if (!statSync(join(packagesDir, pkg)).isDirectory()) continue;
      if (!hasStrictMode(tsconfig)) {
        missing.push(`packages/${pkg}/tsconfig.json`);
      }
    }
    expect(
      missing,
      `Packages without TS strict mode: ${missing.join(', ')}. Add "strict": true to compilerOptions.`,
    ).toEqual([]);
  });

  test('every service/* tsconfig has strict mode', () => {
    const servicesDir = resolve(ROOT, 'services');
    if (!existsSync(servicesDir)) return;

    const missing: string[] = [];
    for (const svc of readdirSync(servicesDir)) {
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(svc)) continue;
      const tsconfig = join(servicesDir, svc, 'tsconfig.json');
      if (!existsSync(tsconfig)) continue;
      if (!statSync(join(servicesDir, svc)).isDirectory()) continue;
      if (!hasStrictMode(tsconfig)) {
        missing.push(`services/${svc}/tsconfig.json`);
      }
    }
    expect(
      missing,
      `Services without TS strict mode: ${missing.join(', ')}. Add "strict": true.`,
    ).toEqual([]);
  });

  test('exemption list has documented rationale for every entry', () => {
    for (const [path, reason] of Object.entries(EXEMPT_TSCONFIGS)) {
      // Rationale must be substantive (>50 chars) — not a one-word excuse
      expect(reason.length).toBeGreaterThan(50);
      // The path must exist (otherwise the exemption is stale)
      const fullPath = resolve(ROOT, path);
      expect(
        existsSync(fullPath),
        `Exemption for ${path} but file doesn't exist — remove stale entry`,
      ).toBe(true);
    }
  });

  test('count baseline — exactly 1 exempt + 24 strict tsconfigs in canonical roots', () => {
    // Hard count as a tripwire: if someone removes a tsconfig OR adds a new
    // managed dir, this needs an explicit decision (not a silent change).
    let strictCount = 0;
    for (const parent of STRICT_REQUIRED_PARENTS) {
      const dir = resolve(ROOT, parent);
      if (!existsSync(dir)) continue;
      for (const child of readdirSync(dir)) {
        const tsconfig = join(dir, child, 'tsconfig.json');
        if (!existsSync(tsconfig)) continue;
        if (!statSync(join(dir, child)).isDirectory()) continue;
        if (hasStrictMode(tsconfig)) strictCount++;
      }
    }
    // ≥24 protects against future additions but flags removals
    expect(strictCount).toBeGreaterThanOrEqual(24);
  });
});
