#!/usr/bin/env node
// =============================================================================
// aisha-packages-version-check.mjs — pre-commit gate against stale publishes
// =============================================================================
//
// Closes the silent-failure mode of scripts/aisha-packages-publish.mjs: when
// a contributor edits `packages/<pkg>/src/**` but forgets to bump
// `packages/<pkg>/package.json` version, the auto-publish workflow runs but
// no-ops (idempotent on version match), Verdaccio stays stale, and every
// service consuming `"@aisha/<pkg>": "*"` keeps installing the old code.
// That's the exact PR #73 failure mode this stack already paid for once.
//
// What this script does
// ---------------------
//   1. Read staged files from `git diff --cached --name-only`
//   2. Group by package: `packages/<pkg>/...`
//   3. For each package where any `src/**` file is staged:
//        - Confirm `packages/<pkg>/package.json` is ALSO staged AND
//          its `version` field actually changed
//        - If not → exit 1 with a clear message
//
// Out of scope (intentionally not flagged):
//   - `packages/<pkg>/dist/**` (build artifacts; CI regenerates)
//   - `packages/<pkg>/{README,CHANGELOG,LICENSE}.md` (no code shipped)
//   - `packages/<pkg>/src/**` test files (`*.test.*`, `*.spec.*`, `__tests__/`,
//     `__mocks__/`, `*.md`) — see isSrcPath() for the measured reasoning
//   - `packages/<pkg>/{tsconfig*,vitest.config.*}` (build config; usually
//     paired with src changes anyway and we don't want false positives)
//   - Packages without `publishConfig` (private workspace deps that
//     don't ship)
//
// Override (use sparingly, document why):
//   ALLOW_STALE_PACKAGE_VERSION=1 git commit ...
//
// Exit codes:
//   0   no violations OR all flagged packages have version bumps
//   1   one or more packages have src/** changes without version bump
//   2   misconfiguration (e.g. no git, no packages/ dir)
//
// Note on subprocess safety: this script uses execFileSync with argv arrays,
// never shell strings, so file paths derived from git output cannot inject
// shell metacharacters. The repo-wide security gate would flag execSync(...)
// with template literals containing variables.
// =============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_ROOT = join(ROOT, 'packages');

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

if (process.env.ALLOW_STALE_PACKAGE_VERSION === '1') {
  console.log(`${YELLOW}⚠${NC}  ALLOW_STALE_PACKAGE_VERSION=1 — version-bump check skipped`);
  process.exit(0);
}

if (!existsSync(PKG_ROOT)) {
  console.log(`${DIM}∅  no packages/ directory, nothing to check${NC}`);
  process.exit(0);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function stagedFiles() {
  try {
    return git(['diff', '--cached', '--name-only'])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    console.error(`${RED}✗${NC}  git diff --cached failed: ${err.message}`);
    process.exit(2);
  }
}

function stagedVersionChanged(pkgRelPath) {
  // Returns true iff staged change to packages/<pkg>/package.json modifies the "version" field.
  // Compares HEAD's version vs the staged-index version: if they differ, version was bumped.
  let headVersion = null;
  try {
    const headJson = git(['show', `HEAD:${pkgRelPath}`]);
    headVersion = JSON.parse(headJson).version;
  } catch (err) {
    // File doesn't exist in HEAD (new package): any version counts as a bump.
    // Log so the operator can see why we treated it as bumped — useful when
    // troubleshooting "why didn't the guard fire on this commit".
    console.warn(
      `${YELLOW}∅${NC}  ${pkgRelPath} not in HEAD (new package): treating as bumped (${(err)?.message ?? 'no detail'})`,
    );
    return true;
  }
  let stagedVersion = null;
  try {
    const stagedJson = git(['show', `:${pkgRelPath}`]);
    stagedVersion = JSON.parse(stagedJson).version;
  } catch (err) {
    console.error(`${RED}✗${NC}  could not read staged ${pkgRelPath}: ${err.message}`);
    return false;
  }
  return headVersion !== stagedVersion;
}

function isPublishablePackage(pkgDir) {
  const pkgPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    // Same eligibility rule the publish runner uses — if it's not publishable,
    // version-bump discipline doesn't apply.
    if (pkg.private === true) return false;
    if (!pkg.publishConfig) return false;
    return true;
  } catch {
    return false;
  }
}

// Testy a dokumentace UVNITŘ src/ — zabalí se, ale nikdo je nekonzumuje.
//
// ⛔ TENHLE SEZNAM DŘÍV EXISTOVAL JEN V KOMENTÁŘI. Komentář nad isSrcPath()
// sliboval „Reject paths that look like build/test/docs", ale kód dělal jen
// kladnou shodu. Naměřeno 2026-09-01: změna JEDINÉHO souboru
// packages/web-canvas/src/index.test.ts vynutila bump 0.2.1 → 0.2.2, tedy
// publikaci funkčně identického balíčku.
//
// Proč je vyloučení správné, a ne změkčení brány — tři měření:
//   1. 19 z 23 balíčků má ve `files` i `src`, TAKŽE TESTY SE OPRAVDU ZABALÍ.
//      Jenže důvod, proč se `src` shipuje, jsou SOURCEMAPY: každý ověřený
//      balíček má v dist/ soubory .map ukazující do ../src. Testy tam jedou
//      s sebou jako vedlejší produkt, ne jako obsah.
//   2. ŽÁDNÝ `exports` v žádném package.json neukazuje na .test./.spec.
//   3. ŽÁDNÝ netestový soubor v packages/*/src žádný test neimportuje.
// Konzument se tedy k testu nedostane ani omylem.
//
// A hlavně: účel téhle brány je podle její vlastní hlavičky „consumers keep
// getting old code". Test není kód, který konzument dostane — na něj se ten
// důvod nevztahuje.
//
// POZOR NA HRANICI: vylučuje se jen to, co je testem podle JMÉNA. `testUtils.ts`
// nebo `fixtures.ts` jsou pořád kód a bump vynutí dál. Kdo sem chce přidat
// vzor, ať doloží, že takový soubor nemůže skončit v runtime cestě.
const NENI_KOD = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /\.md$/i,
];

function isSrcPath(repoRelPath) {
  // Match `packages/<pkg>/src/**`, minus test/docs paths (viz NENI_KOD výš).
  const m = repoRelPath.match(/^packages\/([^/]+)\/src\//);
  if (!m) return null;
  if (NENI_KOD.some((vzor) => vzor.test(repoRelPath))) return null;
  return m[1];
}

function isPackageJson(repoRelPath) {
  const m = repoRelPath.match(/^packages\/([^/]+)\/package\.json$/);
  return m ? m[1] : null;
}

function main() {
  const files = stagedFiles();
  if (files.length === 0) {
    process.exit(0);
  }

  // Bucket: pkgName → { hasSrcChange, hasPkgJsonChange, srcFiles[], packageJsonRelPath }
  const buckets = new Map();

  for (const f of files) {
    const srcPkg = isSrcPath(f);
    const jsonPkg = isPackageJson(f);
    const pkgName = srcPkg || jsonPkg;
    if (!pkgName) continue;

    if (!buckets.has(pkgName)) {
      buckets.set(pkgName, {
        hasSrcChange: false,
        hasPkgJsonChange: false,
        srcFiles: [],
        packageJsonRelPath: `packages/${pkgName}/package.json`,
      });
    }
    const b = buckets.get(pkgName);
    if (srcPkg) {
      b.hasSrcChange = true;
      b.srcFiles.push(f);
    }
    if (jsonPkg) {
      b.hasPkgJsonChange = true;
    }
  }

  const violations = [];
  for (const [pkgName, info] of buckets.entries()) {
    if (!info.hasSrcChange) continue;
    const pkgDir = join(PKG_ROOT, pkgName);
    if (!isPublishablePackage(pkgDir)) continue;
    if (!info.hasPkgJsonChange) {
      violations.push({ pkgName, info, reason: 'no package.json staged' });
      continue;
    }
    if (!stagedVersionChanged(info.packageJsonRelPath)) {
      violations.push({ pkgName, info, reason: 'package.json staged but version field unchanged' });
    }
  }

  if (violations.length === 0) {
    process.exit(0);
  }

  console.log('');
  console.log(`${RED}${BOLD}✗ Stale-publish guard${NC}`);
  console.log('');
  console.log(`The auto-publish workflow (.forgejo/workflows/aisha-packages-publish.yml)`);
  console.log(`is idempotent on the package version. Shipping code changes without a`);
  console.log(`version bump means the workflow runs but skips the publish — Verdaccio`);
  console.log(`stays stale and consumers using "@aisha/<pkg>": "*" keep getting old code.`);
  console.log('');
  console.log(`The following package(s) have src/** changes but ${BOLD}no version bump${NC}:`);
  console.log('');
  for (const v of violations) {
    const pkgPath = join(PKG_ROOT, v.pkgName, 'package.json');
    let currentVersion = '?';
    try {
      currentVersion = JSON.parse(readFileSync(pkgPath, 'utf-8')).version ?? '?';
    } catch {
      // best-effort
    }
    console.log(`  ${RED}${v.pkgName}${NC} ${DIM}(currently ${currentVersion}; ${v.reason})${NC}`);
    for (const f of v.info.srcFiles.slice(0, 5)) {
      console.log(`    ${DIM}- ${f}${NC}`);
    }
    if (v.info.srcFiles.length > 5) {
      console.log(`    ${DIM}- … +${v.info.srcFiles.length - 5} more${NC}`);
    }
  }
  console.log('');
  console.log(`${BOLD}Fix${NC}:`);
  console.log(`  Bump the version in each affected package.json (patch by default):`);
  for (const v of violations) {
    console.log(`    ${DIM}npm --prefix packages/${v.pkgName} version patch --no-git-tag-version${NC}`);
    console.log(`    ${DIM}git add packages/${v.pkgName}/package.json${NC}`);
  }
  console.log('');
  console.log(`Or, if the changes genuinely don't affect what gets published (e.g. comment-only`);
  console.log(`refactors that don't change behavior), override once with a documented reason`);
  console.log(`in your commit body:`);
  console.log(`  ${DIM}ALLOW_STALE_PACKAGE_VERSION=1 git commit -m "..."${NC}`);
  console.log('');

  process.exit(1);
}

main();
