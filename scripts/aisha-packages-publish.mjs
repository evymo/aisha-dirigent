#!/usr/bin/env node
// =============================================================================
// aisha-packages-publish.mjs — Auto-publish @aisha/* to Verdaccio
// =============================================================================
//
// Walks `packages/*`, picks the ones marked publishable (private:false +
// publishConfig + build script), and for each:
//
//   1. Reads the workspace version from package.json
//   2. Compares against the latest published version on Verdaccio
//      (${VERDACCIO_URL} — auth via VERDACCIO_TOKEN env var)
//   3. If workspace version > published OR workspace version not on registry:
//        a. `npm run build` (clean output dir)
//        b. `npm publish --registry=https://npm.example.com/`
//   4. If workspace version == published OR < published: skip (idempotent)
//
// Order, and a failure in the middle of a run (measured 2026-10-04):
//   Packages are walked in DEPENDENCY order — a package after every repo
//   package it depends on — not alphabetically. The alphabetical walk shipped
//   a dependent BEFORE its dependency (llm-dispatch before security), so a
//   failed dependency left the registry with a dependent built against code
//   that was never published: the very pattern described below.
//
//   A package that fails does NOT stop the run. Stopping would not make the
//   registry any more consistent — what shipped before the failure stays
//   shipped — it would only leave more packages behind. Instead:
//     - packages that do not depend on the failed one still ship;
//     - every package that depends on it, directly or not, is HELD BACK
//       ("blocked") and the run exits 1;
//     - a re-run ships only what is missing: versions already in the registry
//       are skipped by step 4, so catching up is safe to repeat.
//
// What is in the registry must install OUTSIDE this repo (measured 2026-10-04):
//   Inside the repo a package may point at another repo package by PATH
//   (`file:../security`) — the workspace builds from it. Published as-is, that
//   path does not exist at the consumer: `npm install` exits 0, the dependency
//   is silently not installed and the package fails at load (four versions in
//   the registry carry it). So in the manifest that goes OUT, a path to a
//   publishable repo package is written as the range `^<its version>` — the
//   version that is in the registry or ships earlier in this run. The source
//   package.json keeps the path: it is rewritten only for the duration of
//   `npm publish` and put back. A path to a package that is NOT publishable
//   cannot be satisfied and fails the publish, naming both packages.
//   DRY_RUN prints every such rewrite, and names a range without bounds (`*`)
//   on a repo package — left as its author declared it.
//
//   Because the manifest on disk is rewritten for the publish, a run that is
//   killed in between can leave it rewritten. So before anything goes out: a
//   publishable package whose package.json differs from git stops the run
//   (exit 2, the file is named). A leftover must be neither published nor
//   overwritten by a "restore".
//
// This is the systemic fix for the "stale Verdaccio publish" pattern that
// caused PR #73's svc-plugin-system test failure (Verdaccio's @aisha/security
// was missing constantTimeStringCompare because nobody published a fresh
// version after adding it to packages/security/src/).
//
// Triggers:
//   - CI (.forgejo/workflows/aisha-packages-publish.yml) on push to main when
//     packages/** changes
//   - Manual: `node scripts/aisha-packages-publish.mjs`
//
// Environment:
//   VERDACCIO_TOKEN   required — JWT for npm publish against the registry
//   VERDACCIO_URL     required — Verdaccio registry base URL (env-driven; no hardcoded host)
//   DRY_RUN           optional — set to "1" to show what would publish, no side effects
//
// Selection rule for a package to be auto-publishable:
//   - private != true            (explicit owner consent)
//   - has publishConfig in pkg   (knows where it's going)
//   - has scripts.build          (has a real artifact to ship)
//   - is NOT `n8n-nodes-aisha`   (has its own release pipeline in scripts/n8n-release.mjs)
//
// Exit codes:
//   0   all publishable packages either published cleanly or were already up-to-date
//   1   at least one package failed to build or publish, or was held back
//       because a repo package it depends on did not ship in this run
//   2   misconfiguration (missing token, invalid packages/, a package.json that
//       differs from git, etc.)
// =============================================================================
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grafBalicku, poradiZGrafu, sestavSeZavislostmi } from './lib/poradi-sestaveni-balicku.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_ROOT = join(ROOT, 'packages');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

const VERDACCIO_URL = process.env.VERDACCIO_URL;
if (!VERDACCIO_URL) {
  console.error("ERROR: VERDACCIO_URL not set (env-driven; no hardcoded host)");
  process.exit(2);
}
const VERDACCIO_TOKEN = process.env.VERDACCIO_TOKEN ?? '';
// Accept BOTH the DRY_RUN=1 env AND the --dry-run CLI flag. A "--dry-run" that
// SILENTLY PUBLISHES (env-only before 2026-07-15) is a dangerous footgun — the
// flag reads as safe but ships to the registry. Honour --dry-run too, and fail
// LOUD on any other unrecognised --flag so a typo never silently no-ops into a
// real publish.
const CLI_FLAGS = process.argv.slice(2);
const KNOWN_FLAGS = new Set(['--dry-run', '--force']);
const unknown = CLI_FLAGS.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
if (unknown.length) {
  console.error(`ERROR: unknown flag(s): ${unknown.join(' ')} — known: ${[...KNOWN_FLAGS].join(', ')} (or env DRY_RUN=1 / FORCE=1)`);
  process.exit(2);
}
const DRY_RUN = process.env.DRY_RUN === '1' || CLI_FLAGS.includes('--dry-run');
// FORCE=1 bypasses the "workspace version == published → skip" optimization.
// Use case: CVE response when a stuck workflow left Verdaccio in a
// half-published state — operator needs to re-ship the same versions to
// recover. Set via workflow_dispatch input 'force' or CLI env var.
// See docs/security/CVE_RESPONSE_RUNBOOK.md for the canonical flow.
const FORCE = process.env.FORCE === '1' || CLI_FLAGS.includes('--force');

// `n8n-nodes-aisha` ships via its own dedicated release script
// (scripts/n8n-release.mjs) with workspace-specific concerns
// (version sync with n8n container, deploy-to-n8n side effect).
// Auto-publish would conflict with that flow, so we explicitly exclude it.
const EXCLUDED = new Set(['n8n-nodes-aisha']);

function log(level, msg) {
  const prefix = {
    info: `${BLUE}ℹ${NC}`,
    ok: `${GREEN}✓${NC}`,
    warn: `${YELLOW}⚠${NC}`,
    err: `${RED}✗${NC}`,
    skip: `${DIM}∅${NC}`,
  }[level] ?? '·';
  console.log(`  ${prefix} ${msg}`);
}

// Repo-relative path of a package directory — the key of the dependency graph.
function repoPath(pkgDir) {
  return relative(ROOT, pkgDir).split(sep).join('/');
}

// Dependency order: a package comes after every repo package it depends on, so
// a dependency that did not ship is known BEFORE its dependents are considered.
// Packages without a build script are not publishable; they come last and are
// only reported as skipped.
function listPackages(graph) {
  if (!existsSync(PKG_ROOT)) {
    console.error(`${RED}✗${NC} packages/ not found at ${PKG_ROOT}`);
    process.exit(2);
  }
  const ordered = poradiZGrafu(graph);
  const rest = [...graph.keys()].filter((p) => !ordered.includes(p));
  return [...ordered, ...rest].map((p) => join(ROOT, p));
}

function readPkg(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
}

function isPublishable(pkg) {
  if (pkg.private === true) return { ok: false, reason: 'private:true' };
  if (!pkg.publishConfig) return { ok: false, reason: 'no publishConfig' };
  if (!pkg.scripts?.build) return { ok: false, reason: 'no build script' };
  if (EXCLUDED.has(pkg.name) || EXCLUDED.has(pkg.name?.replace(/^@aisha\//, '')))
    return { ok: false, reason: 'excluded (has own release flow)' };
  return { ok: true };
}

// Versions the registry holds, per package name — what the registry answered
// plus what shipped (or, in DRY_RUN, would ship) in this run. Read when a path
// dependency is written out as a version range: see outgoingDeps.
const registryVersions = new Map();

async function publishedVersion(packageName) {
  // Verdaccio JSON API: GET /<scope>%2f<name> with Authorization Bearer.
  registryVersions.set(packageName, new Set());
  const url = `${VERDACCIO_URL.replace(/\/$/, '')}/${packageName.replace('/', '%2f')}`;
  try {
    // 10s ceiling — Verdaccio is in-cluster, normally responds in <1s. If it
    // hangs we want to fail loudly, not block the publish workflow forever.
    const res = await fetch(url, {
      headers: VERDACCIO_TOKEN
        ? { Authorization: `Bearer ${VERDACCIO_TOKEN}`, Accept: 'application/json' }
        : { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null; // Never published
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 401 with auth header = wrong token; surface clearly
      if (res.status === 401) {
        throw new Error(`${packageName}: registry returned 401 (check VERDACCIO_TOKEN scope). Body: ${body.slice(0, 200)}`);
      }
      // Other errors: treat as "not published" so we attempt publish; npm publish
      // will return a clear error if registry rejects
      return null;
    }
    const json = await res.json();
    registryVersions.set(packageName, new Set(Object.keys(json.versions ?? {})));
    return json['dist-tags']?.latest ?? null;
  } catch (err) {
    throw new Error(`${packageName}: registry check failed (${err.message})`);
  }
}

// Semver compare: returns -1 (a<b), 0 (eq), 1 (a>b). Suffixes (-alpha etc) ignored.
function cmpSemver(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

function buildPkg(pkgDir, pkgName) {
  const start = Date.now();
  const res = spawnSync('npm', ['run', 'build'], { cwd: pkgDir, stdio: ['ignore', 'pipe', 'pipe'] });
  const dur = ((Date.now() - start) / 1000).toFixed(1);
  if (res.status !== 0) {
    // BOTH streams. `tsc` reports diagnostics on stdout; npm reports the failed
    // lifecycle on stderr. `stderr || stdout` therefore always dropped the
    // compiler output — the log said "build failed (exit 2)" without a single
    // TS error, so nobody could tell a broken package from a broken workflow.
    const stderr = res.stderr?.toString() ?? '';
    const stdout = res.stdout?.toString() ?? '';
    const lines = `${stdout}\n${stderr}`.split('\n').filter((l) => l.trim() !== '');
    throw new Error(`build failed (exit ${res.status}) — last output:\n${lines.slice(-30).join('\n')}`);
  }
  return dur;
}

// A package that depends on another package of this repo resolves it through
// that package's dist/ — which exists only after it has been built. The runner
// walks packages alphabetically and builds only what it ships, so the
// dependency has to be built first, whether or not it ships in this run.
// Order and "once per run" live in ONE module, shared with build:packages.
const builtThisRun = new Set();

// Packages (repo paths) that were due to ship in this run and did not — failed
// or held back. Their dependents are held back too; see processPackage.
const notShipped = new Set();

function buildWithDeps(pkgDir, pkgName) {
  const self = repoPath(pkgDir);
  let seconds = 0;
  sestavSeZavislostmi({
    koren: ROOT,
    cil: self,
    hotove: builtThisRun,
    sestav: (b) => {
      seconds += Number(buildPkg(join(ROOT, b), b === self ? pkgName : b));
    },
  });
  return seconds.toFixed(1);
}

/**
 * Ensure the package ships the canonical Elastic-2.0 LICENSE text in its tarball.
 * The license SoT is the single root LICENSE file — we copy it into the package
 * dir transiently just before publish (npm auto-includes a LICENSE file in the
 * tarball) instead of committing 8 duplicate copies. Returns a cleanup fn that
 * removes the copy if it wasn't already committed by the package.
 */
function stageLicense(pkgDir) {
  const dest = join(pkgDir, 'LICENSE');
  if (existsSync(dest)) return () => {}; // package ships its own LICENSE — leave it
  const rootLicense = join(ROOT, 'LICENSE');
  if (!existsSync(rootLicense)) return () => {};
  copyFileSync(rootLicense, dest);
  return () => {
    try {
      rmSync(dest);
    } catch (err) {
      log('warn', `could not remove staged LICENSE in ${pkgDir}: ${err.message}`);
    }
  };
}

// Dependency specs that are PATHS: they resolve inside this repo only.
const PATH_SPEC = /^(file:|link:|workspace:)/;
// The fields a consumer installs. devDependencies never leave the repo.
const CONSUMER_DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * How the path dependencies of a package must go OUT: a path to a publishable
 * repo package becomes the range `^<its version>`. Throws — naming both
 * packages — when the path cannot be satisfied outside the repo: the target is
 * not a repo package, is not publishable, or its version is not in the
 * registry. The dependency was processed earlier (dependency order), so by now
 * its version either is in the registry or shipped in this run.
 *
 * `unbounded` lists repo packages declared with a range that accepts anything
 * (`*`): installable, so left as declared — but worth seeing before it ships.
 */
function outgoingDeps(pkg, graph) {
  const byName = new Map([...graph].map(([path, b]) => [b.jmeno, path]));
  const changes = [];
  const unbounded = [];
  for (const field of CONSUMER_DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (byName.has(name) && ['*', '', 'x', 'latest'].includes(String(spec).trim())) unbounded.push({ field, name, spec: String(spec) });
      if (!PATH_SPEC.test(String(spec))) continue;
      const depPath = byName.get(name);
      if (!depPath) {
        throw new Error(`${field}: ${name} is a path (${spec}) to something that is not a package of this repo — ${pkg.name} could not be installed outside it`);
      }
      const dep = readPkg(join(ROOT, depPath));
      const publishable = isPublishable(dep);
      if (!publishable.ok) {
        throw new Error(`${field}: ${name} is a path (${spec}) but ${name} is not publishable (${publishable.reason}) — ${pkg.name} could not be installed outside this repo`);
      }
      if (!registryVersions.get(name)?.has(dep.version)) {
        throw new Error(`${field}: ${name}@${dep.version} is not in the registry — ${pkg.name} would depend on a version nobody can install`);
      }
      changes.push({ field, name, from: String(spec), to: `^${dep.version}` });
    }
  }
  return { changes, unbounded };
}

// Manifests rewritten for a publish and not yet put back. Restored on ANY exit,
// so an interrupted local run cannot leave a rewritten package.json behind.
const pendingRestores = new Set();
process.on('exit', () => {
  for (const restore of pendingRestores) restore();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

/**
 * Write the outgoing dependency ranges into package.json for the duration of
 * `npm publish` (npm publishes the manifest it finds on disk) and return a fn
 * that puts the original bytes back. The committed manifest keeps the path.
 */
function stageManifest(pkgDir, changes) {
  if (changes.length === 0) return () => {};
  const file = join(pkgDir, 'package.json');
  const original = readFileSync(file, 'utf8');
  const manifest = JSON.parse(original);
  for (const c of changes) manifest[c.field][c.name] = c.to;
  const restore = () => {
    writeFileSync(file, original);
    pendingRestores.delete(restore);
  };
  pendingRestores.add(restore);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return restore;
}

function publishPkg(pkgDir, pkgName, version, dryRun) {
  const args = ['publish', '--registry', VERDACCIO_URL];
  if (dryRun) args.push('--dry-run');
  // When FORCE=1, also pass --force to npm so it doesn't refuse to republish
  // an existing version. Verdaccio allows this when the auth token has
  // publish scope; npm clients still need explicit --force to compose the
  // overwrite payload. Only used on the CVE-recovery path.
  if (FORCE) args.push('--force');
  const start = Date.now();
  const env = { ...process.env };
  // npm reads token from .npmrc or registry-specific config. We rely on
  // the CI step running `npm config set //npm.example.com/:_authToken $VERDACCIO_TOKEN`
  // before invoking this script — same convention scripts/n8n-release.mjs uses.
  const res = spawnSync('npm', args, { cwd: pkgDir, stdio: ['ignore', 'pipe', 'pipe'], env });
  const dur = ((Date.now() - start) / 1000).toFixed(1);
  if (res.status !== 0) {
    const stderr = res.stderr?.toString() ?? '';
    const stdout = res.stdout?.toString() ?? '';
    throw new Error(`publish failed (exit ${res.status}) — last stderr:\n${(stderr || stdout).split('\n').slice(-20).join('\n')}`);
  }
  return dur;
}

async function processPackage(pkgDir, graph) {
  const pkg = readPkg(pkgDir);
  const status = isPublishable(pkg);

  if (!status.ok) {
    log('skip', `${pkg.name} ${pkg.version} ${DIM}— not publishable (${status.reason})${NC}`);
    return { name: pkg.name, action: 'skipped', reason: status.reason };
  }

  const workspaceVersion = pkg.version;
  let registered;
  try {
    registered = await publishedVersion(pkg.name);
  } catch (err) {
    log('err', `${pkg.name} — ${err.message}`);
    return { name: pkg.name, action: 'failed', error: err.message };
  }

  if (registered === null) {
    log('info', `${pkg.name} ${workspaceVersion} ${DIM}— never published, will ship${NC}`);
  } else {
    const cmp = cmpSemver(workspaceVersion, registered);
    if (cmp <= 0) {
      if (FORCE) {
        // CVE recovery path: re-ship even though Verdaccio has same/newer
        // version. Useful when a stuck workflow left half-published state
        // and we need to force a fresh publish of the same version tag.
        // See docs/security/CVE_RESPONSE_RUNBOOK.md.
        log('warn', `${pkg.name} ${workspaceVersion} ${DIM}— Verdaccio has ${registered}, FORCE=1 → republishing anyway${NC}`);
      } else {
        log('skip', `${pkg.name} ${workspaceVersion} ${DIM}— Verdaccio has ${registered} (${cmp === 0 ? 'identical' : 'newer'}), skipping${NC}`);
        return { name: pkg.name, action: 'skipped', reason: cmp === 0 ? 'version-unchanged' : 'workspace-behind-registry' };
      }
    } else {
      log('info', `${pkg.name} ${workspaceVersion} ${DIM}— Verdaccio has ${registered}, will ship newer${NC}`);
    }
  }

  // Held back: a repo package this one depends on (directly or not) failed or
  // was itself held back in this run. Shipping now would put a dependent into
  // the registry ahead of its dependency.
  const self = repoPath(pkgDir);
  const missing = poradiZGrafu(graph, [self]).filter((p) => p !== self && notShipped.has(p));
  if (missing.length > 0) {
    const names = missing.map((p) => graph.get(p).jmeno).join(', ');
    log('err', `${pkg.name} ${workspaceVersion} — held back: ${names} did not ship in this run`);
    return { name: pkg.name, action: 'blocked', error: `held back — depends on ${names}, which did not ship in this run` };
  }

  let outgoing;
  try {
    outgoing = outgoingDeps(pkg, graph);
  } catch (err) {
    log('err', `${pkg.name} ${workspaceVersion} — ${err.message}`);
    return { name: pkg.name, action: 'failed', error: err.message };
  }
  for (const c of outgoing.changes) {
    log('info', `${pkg.name} ${workspaceVersion} ${DIM}— goes out with ${c.field}: ${c.name} ${c.from} → ${c.to}${NC}`);
  }
  for (const u of outgoing.unbounded) {
    log('info', `${pkg.name} ${workspaceVersion} ${DIM}— goes out with ${u.field}: ${u.name} ${u.spec || '(empty)'} (range without bounds, left as declared)${NC}`);
  }

  if (DRY_RUN) {
    log('info', `${pkg.name} ${workspaceVersion} ${DIM}— DRY_RUN, skipping build+publish${NC}`);
    // Would ship: its dependents may count on this version being in the registry.
    registryVersions.get(pkg.name).add(workspaceVersion);
    return { name: pkg.name, action: 'dry-run', target: workspaceVersion };
  }

  try {
    const buildDur = buildWithDeps(pkgDir, pkg.name);
    log('ok', `${pkg.name} ${workspaceVersion} — build ${DIM}(${buildDur}s)${NC}`);
  } catch (err) {
    log('err', `${pkg.name} ${workspaceVersion} — ${err.message}`);
    return { name: pkg.name, action: 'failed', error: err.message };
  }

  const cleanupLicense = stageLicense(pkgDir);
  const restoreManifest = stageManifest(pkgDir, outgoing.changes);
  try {
    const pubDur = publishPkg(pkgDir, pkg.name, workspaceVersion, false);
    log('ok', `${pkg.name} ${workspaceVersion} — publish ${DIM}(${pubDur}s)${NC}`);
    registryVersions.get(pkg.name).add(workspaceVersion);
    return { name: pkg.name, action: 'published', version: workspaceVersion };
  } catch (err) {
    log('err', `${pkg.name} ${workspaceVersion} — ${err.message}`);
    return { name: pkg.name, action: 'failed', error: err.message };
  } finally {
    restoreManifest();
    cleanupLicense();
  }
}

/**
 * package.json files of publishable packages that differ from git — the
 * leftover of a killed run (see stageManifest) or an uncommitted edit. Throws
 * when git cannot answer: "cannot tell" is not "clean".
 */
function dirtyManifests(packages) {
  const files = packages.filter((dir) => isPublishable(readPkg(dir)).ok).map((dir) => `${repoPath(dir)}/package.json`);
  if (files.length === 0) return [];
  const res = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...files], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    const why = res.error?.message ?? (res.stderr ?? '').trim().split('\n')[0];
    throw new Error(`cannot tell whether package manifests match git (git status exit ${res.status}): ${why}`);
  }
  return res.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3));
}

async function main() {
  console.log(`${BOLD}AISHA packages auto-publish${NC}`);
  console.log(`${DIM}  registry: ${VERDACCIO_URL}${NC}`);
  console.log(`${DIM}  token: ${VERDACCIO_TOKEN ? `${VERDACCIO_TOKEN.slice(0, 6)}…(${VERDACCIO_TOKEN.length} chars)` : '(not set)'}${NC}`);
  if (FORCE) console.log(`${YELLOW}  FORCE=1 — version-skip optimization bypassed (CVE recovery mode)${NC}`);
  console.log(`${DIM}  dry-run: ${DRY_RUN ? 'yes' : 'no'}${NC}`);
  console.log('');

  if (!VERDACCIO_TOKEN && !DRY_RUN) {
    console.error(`${RED}✗${NC} VERDACCIO_TOKEN not set; cannot publish. Set DRY_RUN=1 to preview without it.`);
    process.exit(2);
  }

  const graph = grafBalicku(ROOT);
  const packages = listPackages(graph);
  if (packages.length === 0) {
    console.error(`${RED}✗${NC} no packages found under ${PKG_ROOT}`);
    process.exit(2);
  }

  let dirty;
  try {
    dirty = dirtyManifests(packages);
  } catch (err) {
    console.error(`${RED}✗${NC} ${err.message}`);
    process.exit(2);
  }
  if (dirty.length > 0) {
    console.error(`${RED}✗${NC} package manifest(s) differ from git — nothing is published:`);
    for (const file of dirty) console.error(`    - ${file}`);
    console.error('  A killed publish run can leave a rewritten package.json behind. Restore or commit it, then re-run.');
    process.exit(2);
  }

  const results = [];
  for (const pkgDir of packages) {
    const result = await processPackage(pkgDir, graph);
    if (result.action === 'failed' || result.action === 'blocked') notShipped.add(repoPath(pkgDir));
    results.push(result);
  }

  console.log('');
  console.log(`${BOLD}━━ summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  const counts = results.reduce(
    (acc, r) => {
      acc[r.action] = (acc[r.action] ?? 0) + 1;
      return acc;
    },
    {},
  );
  for (const [action, n] of Object.entries(counts)) {
    const color = action === 'failed' || action === 'blocked' ? RED : action === 'published' ? GREEN : DIM;
    console.log(`  ${color}${action}${NC}: ${n}`);
  }

  const failed = results.filter((r) => r.action === 'failed' || r.action === 'blocked');
  if (failed.length > 0) {
    console.log('');
    console.log(`${RED}✗${NC} ${failed.length} package(s) did not ship (a re-run ships only what is missing):`);
    for (const f of failed) console.log(`    - ${f.name}: ${f.error?.split('\n')[0] ?? '(no detail)'}`);
    process.exit(1);
  }

  console.log('');
  console.log(`${GREEN}✓${NC} all done`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${RED}✗${NC} unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
