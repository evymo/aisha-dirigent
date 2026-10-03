/**
 * Gate: service builds are REGISTRY-FREE (workspace-from-source, zero npm token).
 *
 * Decision (2026-07-07): internal `@aisha/*` packages are monorepo WORKSPACE
 * packages (packages/*). Service Dockerfiles MUST resolve them from source via
 * npm workspace symlinks — NEVER from a registry, NEVER with an npm auth token.
 * Verdaccio stays ONLY for external distribution (publish side); it is not a
 * build-time dependency of any service image.
 *
 * WHY: the old `.npmrc` + `ARG VERDACCIO_TOKEN` + `npm install` + bare
 * `npm prune --omit=dev` form re-resolved `@aisha/*` against the PUBLIC registry
 * whenever the build cache busted (the `.npmrc` was deleted before prune ran) —
 * a non-deterministic cold-start bomb (E404 on npmjs) that downed aisha-realtime.
 * It also baked a hardcoded npm token into the build.
 *
 * Canonical example: services/svc-web-artifact/Dockerfile / services/gateway/Dockerfile.
 *
 * Invariants for every services/<svc>/Dockerfile (and root Dockerfile.<svc>)
 * that depends on an @aisha/* workspace package:
 *   1. Uses `npm ci --workspace=@aisha/<svc>` (deps resolve via local symlinks).
 *   2. Multi-stage (dev deps + repo source never reach the runtime image).
 *   3. NO npm auth token anywhere: no `ARG VERDACCIO_TOKEN`, no `@aisha:_authToken`,
 *      no `COPY .npmrc` — internal code never round-trips a registry.
 *   4. If the service IS wired into a compose, that build.context is repo root `.`
 *      (so `COPY . .` sees the whole workspace graph).
 *   5. No compose build block passes VERDACCIO_URL/VERDACCIO_TOKEN as a build arg.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isTrackedService } from './lib/tracked-services';

const ROOT = process.cwd();
const SERVICES_DIR = path.join(ROOT, 'services');
const AISHA_PREFIX = '@' + 'aisha/';

function readJsonOrEmpty(p: string): Record<string, unknown> {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}
function readFileOrEmpty(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function hasAishaDep(svcDir: string): boolean {
  const pkg = readJsonOrEmpty(path.join(svcDir, 'package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(deps).some((k) => k.startsWith(AISHA_PREFIX));
}

/** Services (dir name) that ship a Dockerfile — in services/<svc>/ or root Dockerfile.<svc> — and depend on @aisha/*. */
function listServices(): string[] {
  if (!fs.existsSync(SERVICES_DIR)) return [];
  const out = new Set<string>();
  for (const entry of fs.readdirSync(SERVICES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
    if (!isTrackedService(entry.name)) continue;
    const svcDir = path.join(SERVICES_DIR, entry.name);
    if (fs.existsSync(path.join(svcDir, 'Dockerfile')) && hasAishaDep(svcDir)) out.add(entry.name);
  }
  for (const entry of fs.readdirSync(ROOT)) {
    const m = entry.match(/^Dockerfile\.(svc-[a-z0-9-]+)$/);
    if (!m) continue;
    const svcDir = path.join(SERVICES_DIR, m[1]);
    if (fs.existsSync(svcDir) && hasAishaDep(svcDir)) out.add(m[1]);
  }
  return [...out].sort();
}

/** True if any compose build block names this exact dockerfile filename. */
function rootDockerfileIsBuilt(fileName: string): boolean {
  const re = new RegExp('dockerfile:\\s*' + fileName.replace('.', '\\.') + '\\b');
  for (const entry of fs.readdirSync(ROOT)) {
    if (!/^docker-compose.*\.ya?ml$/.test(entry)) continue;
    if (re.test(readFileOrEmpty(path.join(ROOT, entry)))) return true;
  }
  return false;
}

/**
 * The Dockerfile(s) actually built for a service: always services/<svc>/Dockerfile
 * (canonical location) if present, plus a root-level Dockerfile.<svc> ONLY when a
 * compose actually builds it (skips dead/superseded root-level duplicates — a
 * migrated service leaves its old Dockerfile.<svc> orphaned; it is not built).
 */
function resolveDockerfiles(svc: string): string[] {
  const files: string[] = [];
  const inServices = path.join(SERVICES_DIR, svc, 'Dockerfile');
  const rootLevel = path.join(ROOT, `Dockerfile.${svc}`);
  if (fs.existsSync(inServices)) files.push(inServices);
  if (fs.existsSync(rootLevel) && rootDockerfileIsBuilt(`Dockerfile.${svc}`)) files.push(rootLevel);
  return files;
}

function isMultiStage(df: string): boolean {
  return (df.match(/^FROM\s+/gm) || []).length >= 2;
}

/** True if the service is referenced by a compose build block. */
function composeRefs(svc: string): { file: string; content: string }[] {
  const refs: { file: string; content: string }[] = [];
  const dfRefA = new RegExp('dockerfile:\\s*services/' + svc + '/Dockerfile\\b');
  const dfRefB = new RegExp('context:\\s*\\./?services/' + svc + '\\b');
  const dfRefC = new RegExp('dockerfile:\\s*Dockerfile\\.' + svc + '\\b');
  for (const entry of fs.readdirSync(ROOT)) {
    if (!/^docker-compose.*\.ya?ml$/.test(entry)) continue;
    const content = readFileOrEmpty(path.join(ROOT, entry));
    if (dfRefA.test(content) || dfRefB.test(content) || dfRefC.test(content)) {
      refs.push({ file: entry, content });
    }
  }
  return refs;
}

describe('service builds are registry-free (workspace-from-source, zero npm token)', () => {
  const services = listServices();

  it('discovery: found a non-trivial number of @aisha-dep services', () => {
    expect(services.length).toBeGreaterThan(10);
  });

  for (const svc of services) {
    describe('service ' + svc, () => {
      for (const df of resolveDockerfiles(svc)) {
        const rel = path.relative(ROOT, df);
        const content = readFileOrEmpty(df);

        it(`${rel}: resolves @aisha/* via npm workspace (npm ci --workspace)`, () => {
          expect(
            content,
            `${rel} must install via \`npm ci --workspace=@aisha/${svc} --include-workspace-root\` — @aisha/* build from source, not a registry`,
          ).toMatch(/npm\s+ci\s+[^\n]*--workspace[=\s]@aisha\//);
        });

        it(`${rel}: is multi-stage (dev deps never reach runtime)`, () => {
          expect(isMultiStage(content), `${rel} must be multi-stage`).toBe(true);
        });

        it(`${rel}: carries NO npm auth token (no VERDACCIO_TOKEN / _authToken / COPY .npmrc)`, () => {
          const offenders: string[] = [];
          if (/^ARG\s+VERDACCIO_TOKEN\b/m.test(content)) offenders.push('ARG VERDACCIO_TOKEN');
          if (/@aisha:_authToken=/.test(content)) offenders.push('@aisha:_authToken=');
          if (/COPY\s+\.npmrc\b/.test(content)) offenders.push('COPY .npmrc');
          expect(
            offenders,
            `${rel} must NOT use a Verdaccio auth token — @aisha/* are workspace packages built from source. Offenders: ${offenders.join(', ')}`,
          ).toEqual([]);
        });

        it(`${rel}: if wired into a compose, build.context is repo root (.)`, () => {
          const refs = composeRefs(svc);
          if (refs.length === 0) return; // not deployed — Dockerfile still correct
          for (const { file, content: c } of refs) {
            const lines = c.split('\n');
            const dfRe = new RegExp(
              'dockerfile:\\s*(services/' + svc + '/Dockerfile|Dockerfile\\.' + svc + ')\\b',
            );
            let ok = false;
            for (let i = 0; i < lines.length; i++) {
              if (!dfRe.test(lines[i])) continue;
              for (let j = Math.max(0, i - 6); j < Math.min(lines.length, i + 7); j++) {
                if (/^\s*context:\s*\.\s*(#.*)?$/.test(lines[j])) ok = true;
              }
            }
            expect(
              ok,
              `${svc}: ${file} build block must set \`context: .\` (repo root) so \`COPY . .\` sees the workspace graph`,
            ).toBe(true);
          }
        });
      }
    });
  }

  it('no compose build block passes VERDACCIO_URL/VERDACCIO_TOKEN as a build arg', () => {
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(ROOT)) {
      if (!/^docker-compose.*\.ya?ml$/.test(entry)) continue;
      const lines = readFileOrEmpty(path.join(ROOT, entry)).split('\n');
      lines.forEach((ln, i) => {
        if (/^\s*VERDACCIO_(URL|TOKEN)\s*:/.test(ln)) offenders.push(`${entry}:${i + 1}  ${ln.trim()}`);
      });
    }
    expect(
      offenders,
      `Verdaccio build args must be gone from service builds (token-free). Offenders:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
