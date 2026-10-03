/**
 * Gate: every service Docker image that builds with dev deps then slims to prod
 * MUST run the fail-loud runtime-dependency guard (scripts/verify-runtime-deps.mjs).
 *
 * WHY: `npm ci --include=dev` (to build) + `npm prune --workspace=<svc> --omit=dev`
 * (to slim) can wrongly EVICT a hoisted PRODUCTION dependency. It happened to
 * svc-web-artifact — jsdom (a declared prod dep on the /parse + /seed-default
 * routes) vanished from the image, and the service crash-looped in prod with
 * ERR_MODULE_NOT_FOUND (~18k restarts) because nothing failed the BUILD.
 *
 * The guard converts that silent-prod-crashloop class into a build failure: it
 * checks that every dependency the service DECLARES is actually installed. This
 * gate locks the guard into place across the affected service Dockerfiles so the
 * protection can't be silently dropped, and locks svc-web-artifact's actual fix
 * (deterministic `npm ci --omit=dev` instead of the misfiring workspace prune).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

// Services whose Dockerfile builds with dev deps then slims to a prod-only image.
const GUARDED_SERVICES = ['gateway', 'svc-ai-chat', 'svc-mcp-knowledge', 'svc-web-artifact'];

const GUARD_SCRIPT = path.join(ROOT, 'scripts/verify-runtime-deps.mjs');

describe('service runtime-dependency guard (verify-runtime-deps.mjs)', () => {
  it('the guard script exists and is executable Node', () => {
    expect(fs.existsSync(GUARD_SCRIPT), 'scripts/verify-runtime-deps.mjs must exist').toBe(true);
    const body = fs.readFileSync(GUARD_SCRIPT, 'utf8');
    // It reads the service's own declared deps — NOT a hardcoded allow-list.
    expect(body).toMatch(/dependencies/);
    expect(body).toMatch(/process\.exit\(1\)/);
  });

  for (const svc of GUARDED_SERVICES) {
    it(`services/${svc}/Dockerfile runs the runtime-dep guard`, () => {
      const df = path.join(ROOT, 'services', svc, 'Dockerfile');
      expect(fs.existsSync(df), `${df} must exist`).toBe(true);
      const body = fs.readFileSync(df, 'utf8');
      const re = new RegExp(`verify-runtime-deps\\.mjs\\s+services/${svc}\\b`);
      expect(
        re.test(body),
        `services/${svc}/Dockerfile must run \`node scripts/verify-runtime-deps.mjs services/${svc}\` to fail the build loudly if a declared prod dep was pruned/evicted`,
      ).toBe(true);
    });
  }

  it('svc-web-artifact uses a deterministic prod install, NOT the misfiring workspace prune', () => {
    const df = path.join(ROOT, 'services/svc-web-artifact/Dockerfile');
    const body = fs.readFileSync(df, 'utf8');
    // The fix: clean reinstall of the prod closure.
    expect(
      body,
      'svc-web-artifact must install prod deps with `npm ci ... --omit=dev` (the workspace-scoped prune evicted jsdom)',
    ).toMatch(/npm ci\b[^\n]*--omit=dev/);
    // And must NOT reintroduce the bare workspace prune that dropped jsdom.
    expect(
      body,
      'svc-web-artifact must NOT use `npm prune --workspace=@aisha/svc-web-artifact --omit=dev` — it evicted the hoisted jsdom prod dep',
    ).not.toMatch(/npm prune --workspace=@aisha\/svc-web-artifact --omit=dev/);
  });
});
