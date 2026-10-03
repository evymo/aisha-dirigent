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
//   1   at least one package failed to build or publish
//   2   misconfiguration (missing token, invalid packages/, etc.)
// =============================================================================
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function listPackages() {
  if (!existsSync(PKG_ROOT)) {
    console.error(`${RED}✗${NC} packages/ not found at ${PKG_ROOT}`);
    process.exit(2);
  }
  return readdirSync(PKG_ROOT)
    .map((entry) => join(PKG_ROOT, entry))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => existsSync(join(p, 'package.json')));
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

async function publishedVersion(packageName) {
  // Verdaccio JSON API: GET /<scope>%2f<name> with Authorization Bearer.
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
    const stderr = res.stderr?.toString() ?? '';
    const stdout = res.stdout?.toString() ?? '';
    throw new Error(`build failed (exit ${res.status}) — last stderr:\n${(stderr || stdout).split('\n').slice(-15).join('\n')}`);
  }
  return dur;
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

async function processPackage(pkgDir) {
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

  if (DRY_RUN) {
    log('info', `${pkg.name} ${workspaceVersion} ${DIM}— DRY_RUN, skipping build+publish${NC}`);
    return { name: pkg.name, action: 'dry-run', target: workspaceVersion };
  }

  try {
    const buildDur = buildPkg(pkgDir, pkg.name);
    log('ok', `${pkg.name} ${workspaceVersion} — build ${DIM}(${buildDur}s)${NC}`);
  } catch (err) {
    log('err', `${pkg.name} ${workspaceVersion} — ${err.message}`);
    return { name: pkg.name, action: 'failed', error: err.message };
  }

  const cleanupLicense = stageLicense(pkgDir);
  try {
    const pubDur = publishPkg(pkgDir, pkg.name, workspaceVersion, false);
    log('ok', `${pkg.name} ${workspaceVersion} — publish ${DIM}(${pubDur}s)${NC}`);
    return { name: pkg.name, action: 'published', version: workspaceVersion };
  } catch (err) {
    log('err', `${pkg.name} ${workspaceVersion} — ${err.message}`);
    return { name: pkg.name, action: 'failed', error: err.message };
  } finally {
    cleanupLicense();
  }
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

  const packages = listPackages();
  if (packages.length === 0) {
    console.error(`${RED}✗${NC} no packages found under ${PKG_ROOT}`);
    process.exit(2);
  }

  const results = [];
  for (const pkgDir of packages) {
    results.push(await processPackage(pkgDir));
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
    const color = action === 'failed' ? RED : action === 'published' ? GREEN : DIM;
    console.log(`  ${color}${action}${NC}: ${n}`);
  }

  const failed = results.filter((r) => r.action === 'failed');
  if (failed.length > 0) {
    console.log('');
    console.log(`${RED}✗${NC} ${failed.length} package(s) failed to publish:`);
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
