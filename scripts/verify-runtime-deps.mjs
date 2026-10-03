#!/usr/bin/env node
// verify-runtime-deps.mjs — fail LOUD at build time when a service declares a
// production dependency that isn't actually present in the built image layout.
//
// WHY THIS EXISTS
//   `npm ci --include=dev` (to build) followed by `npm prune --workspace=<svc>
//   --omit=dev` (to slim the image) can WRONGLY evict a *hoisted production*
//   dependency: the workspace-scoped prune heuristic misfires on deep trees.
//   jsdom disappeared from svc-web-artifact's image this way — a declared prod
//   dep, gone — and the service crash-looped in prod with ERR_MODULE_NOT_FOUND
//   (~18k restarts) because nothing failed the BUILD. This guard converts that
//   whole class of "silent prod crashloop" into a build failure.
//
// It is NOT an allow-list: it reads the service's OWN package.json
// "dependencies" and checks each is installed. The service's declared deps are
// the spec.
//
// USAGE (in a Dockerfile build stage, cwd = repo root, AFTER the prod install):
//   node scripts/verify-runtime-deps.mjs services/svc-web-artifact
//
// Resolution mirrors Node's runtime: walk up from the service dir collecting
// node_modules roots, and require each dependency's package.json to exist in one
// of them (fs check — avoids ESM/exports-map quirks of require.resolve).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const svcArg = process.argv[2];
if (!svcArg) {
  console.error('[verify-runtime-deps] FATAL: usage: node scripts/verify-runtime-deps.mjs <serviceDir>');
  process.exit(2);
}

const svcDir = resolve(svcArg);
const pkgPath = join(svcDir, 'package.json');
if (!existsSync(pkgPath)) {
  console.error(`[verify-runtime-deps] FATAL: no package.json at ${pkgPath}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length === 0) {
  console.log(`[verify-runtime-deps] ${pkg.name ?? svcArg}: no runtime dependencies declared — ok`);
  process.exit(0);
}

// node_modules roots Node would traverse at runtime, from the service dir upward.
const roots = [];
let dir = svcDir;
for (;;) {
  roots.push(join(dir, 'node_modules'));
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const resolvable = (dep) => roots.some((root) => existsSync(join(root, dep, 'package.json')));

const missing = deps.filter((dep) => !resolvable(dep));
if (missing.length > 0) {
  const plural = missing.length === 1 ? 'y' : 'ies';
  console.error(
    `[verify-runtime-deps] FATAL: ${pkg.name ?? svcArg} declares ${missing.length} production dependenc${plural} NOT installed in the image:`,
  );
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    '[verify-runtime-deps] These would crash the service at runtime with ERR_MODULE_NOT_FOUND.',
  );
  console.error(
    '[verify-runtime-deps] A prune/hoist step dropped them — refuse to ship this image; fix the prod install.',
  );
  process.exit(1);
}

console.log(`[verify-runtime-deps] ${pkg.name ?? svcArg}: all ${deps.length} runtime dependencies resolvable — ok`);
