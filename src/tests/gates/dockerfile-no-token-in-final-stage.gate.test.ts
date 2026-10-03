/**
 * Gate: no build-secret (VERDACCIO_TOKEN) may be referenced in a Dockerfile's
 * FINAL stage — it would bake the token into the shipped image's `docker history`.
 *
 * WHY: the WP-0.1b service Dockerfiles used `ARG VERDACCIO_TOKEN` + a
 * `RUN printf '...@aisha:_authToken=$VERDACCIO_TOKEN...' > .npmrc && npm install`
 * in BOTH the build stage AND the final stage. `rm -f .npmrc` removes the file,
 * but BuildKit records the build-arg VALUE into the layer's `created_by` metadata,
 * so `docker history` on the final image leaked the live Verdaccio token
 * (CIS-4.10, caught by an image scan 2026-07-06).
 *
 * The fix: the token is used ONLY in the (discarded) build stage; the final stage
 * copies node_modules from the build stage and declares no token ARG. This gate
 * locks that invariant for every Dockerfile so the leak can't reappear.
 *
 * A token reference in a BUILD stage (before the last FROM) is allowed — that
 * stage never ships. Only the final stage (after the last FROM) is scanned.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

function findDockerfiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.claude') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // only descend into project source dirs, not vendored trees
      if (full.split(path.sep).includes('node_modules')) continue;
      findDockerfiles(full, acc);
    } else if (/^Dockerfile(\..+)?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Restrict to first-party build dirs to keep the scan fast + deterministic.
const SCAN_DIRS = [ROOT, path.join(ROOT, 'services')];
const dockerfiles = Array.from(
  new Set(
    SCAN_DIRS.flatMap((d) => (fs.existsSync(d) ? findDockerfiles(d) : [])),
  ),
).filter((f) => !f.split(path.sep).includes('node_modules'));

// Secrets that must never appear in a final stage.
const FORBIDDEN = /VERDACCIO_TOKEN|_authToken/;

describe('Dockerfiles: no build secret in the final (shipped) stage', () => {
  it('scans a non-trivial number of Dockerfiles', () => {
    expect(dockerfiles.length).toBeGreaterThan(10);
  });

  for (const df of dockerfiles) {
    const rel = path.relative(ROOT, df);
    it(`${rel}: final stage carries no VERDACCIO_TOKEN/_authToken`, () => {
      const lines = fs.readFileSync(df, 'utf8').split('\n');
      const fromIdxs = lines
        .map((l, i) => (/^FROM\s/i.test(l) ? i : -1))
        .filter((i) => i >= 0);
      if (fromIdxs.length === 0) return; // not a build Dockerfile
      const lastFrom = fromIdxs[fromIdxs.length - 1];
      const finalStage = lines.slice(lastFrom);
      const offenders = finalStage
        .map((l, i) => ({ l, n: lastFrom + i + 1 }))
        .filter(({ l }) => !/^\s*#/.test(l) && FORBIDDEN.test(l));
      expect(
        offenders,
        `${rel} references a build secret in its FINAL stage (after line ${lastFrom + 1}) — it would leak into 'docker history'. Use the token ONLY in the build stage and COPY --from=build node_modules into the final stage:\n${offenders.map((o) => `  L${o.n}: ${o.l.trim().slice(0, 80)}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});
