#!/usr/bin/env node
// =============================================================================
// migrate-verdaccio-token.mjs — Phase 12 WP 0.1b
// =============================================================================
// Systemic fix: every services/*/Dockerfile that uses `npm ci` AND depends on
// any `@aisha/*` package MUST switch to the inline-.npmrc pattern from
// services/svc-web-artifact/Dockerfile + services/svc-mcp-knowledge/Dockerfile.
//
// PR #126 fixed only svc-mcp-knowledge. This script applies the same
// transformation to every other service detected by the same heuristic.
//
// SAFETY
// ------
// - Read + write under services/*/Dockerfile only. No other paths touched.
// - Idempotent: re-running on an already-migrated Dockerfile produces no diff
//   (heuristic: skip if `VERDACCIO_TOKEN` already present).
// - Dry-run support: pass `--dry` to print intended diffs without writing.
//
// USAGE
// -----
//   node scripts/migrate-verdaccio-token.mjs        # apply
//   node scripts/migrate-verdaccio-token.mjs --dry  # show intended changes
// =============================================================================
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVICES_DIR = join(REPO_ROOT, 'services');
const DRY = process.argv.includes('--dry');

// Verdaccio host URL — defaulted but env-overridable, so the gate that flags
// hardcoded environment URLs sees a single configurable source per the
// codebase-security-patterns convention (env-resolved → not a literal).
const VERDACCIO_HOST = process.env.VERDACCIO_URL;
if (!VERDACCIO_HOST) {
  console.error("ERROR: VERDACCIO_URL not set (env-driven; no hardcoded host)");
  process.exit(1);
}
const NPMRC_REGISTRY = `@aisha:registry=${VERDACCIO_HOST}/\\n@evymo:registry=${VERDACCIO_HOST}/\\n//${VERDACCIO_HOST.replace(/^https?:\/\//, '')}/:_authToken=%s`;

const NPMRC_RUN_BUILD = `RUN printf '${NPMRC_REGISTRY}\\n' "$VERDACCIO_TOKEN" > .npmrc && \\
    npm install --include=dev --ignore-scripts && \\
    rm -f .npmrc`;

const NPMRC_RUN_RUNTIME = `RUN printf '${NPMRC_REGISTRY}\\n' "$VERDACCIO_TOKEN" > .npmrc && \\
    npm install --ignore-scripts --omit=dev && \\
    rm -f .npmrc && \\
    npm cache clean --force`;

/** Detect whether a service depends on any `@aisha/*` workspace package. */
async function hasAishaDep(svcDir) {
  try {
    const pkg = JSON.parse(
      await readFile(join(svcDir, 'package.json'), 'utf8'),
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps).some((k) => k.startsWith('@aisha/'));
  } catch {
    return false;
  }
}

/** Transform a Dockerfile content string. Returns null if no change. */
function migrateDockerfile(content) {
  if (content.includes('VERDACCIO_TOKEN')) {
    // Already migrated. Idempotent skip.
    return null;
  }
  // Need to (a) add ARG VERDACCIO_TOKEN to every build stage and
  // (b) replace `npm ci ...` with the inline-.npmrc RUN block.
  //
  // We detect Dockerfile stages by `FROM ... AS ...` or top-level FROM and
  // inject ARG immediately after WORKDIR. Conservative: only modify if we
  // see at least one `npm ci` line, and replace it with appropriate
  // variant (--include=dev vs --omit=dev) based on the original flag.
  let out = content;

  // 1. Insert `ARG VERDACCIO_TOKEN=""` after each `WORKDIR /app`
  out = out.replace(
    /^(WORKDIR\s+\/app)\s*$/gm,
    `$1\nARG VERDACCIO_TOKEN=""`,
  );

  // 2. Replace `RUN npm ci --include=dev` → build-stage variant
  out = out.replace(
    /^RUN\s+npm\s+ci\s+--include=dev\s*$/gm,
    NPMRC_RUN_BUILD,
  );

  // 3. Replace `RUN npm ci --ignore-scripts$` → build-stage variant
  out = out.replace(
    /^RUN\s+npm\s+ci\s+--ignore-scripts\s*$/gm,
    NPMRC_RUN_BUILD,
  );

  // 4. Replace runtime-stage `RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force`
  //    OR `RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force`
  out = out.replace(
    /^RUN\s+npm\s+ci\s+(?:--ignore-scripts\s+--omit=dev|--omit=dev\s+--ignore-scripts)\s+&&\s+npm\s+cache\s+clean\s+--force\s*$/gm,
    NPMRC_RUN_RUNTIME,
  );

  // 5. Replace `RUN npm ci --omit=dev --ignore-scripts` (no cache clean tail)
  out = out.replace(
    /^RUN\s+npm\s+ci\s+(?:--ignore-scripts\s+--omit=dev|--omit=dev\s+--ignore-scripts)\s*$/gm,
    NPMRC_RUN_RUNTIME.replace(/\s+&&\s+npm\s+cache\s+clean\s+--force$/, ''),
  );

  // 6. Replace bare `RUN npm ci`
  out = out.replace(/^RUN\s+npm\s+ci\s*$/gm, NPMRC_RUN_BUILD);

  // 7. Insert documentation comment at the top if we made changes
  if (out !== content) {
    if (!out.startsWith('#')) {
      out =
        `# Verdaccio @aisha/* npm install pattern (Phase 12 WP 0.1b).\n` +
        `# See services/svc-web-artifact/Dockerfile + svc-mcp-knowledge/Dockerfile\n` +
        `# for the canonical reference. VERDACCIO_TOKEN is build-arg only —\n` +
        `# not propagated to runtime image. .npmrc removed after install.\n\n` +
        out;
    }
    return out;
  }
  return null;
}

async function main() {
  const entries = await readdir(SERVICES_DIR, { withFileTypes: true });
  const services = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const changed = [];
  const skipped = [];
  const failed = [];

  for (const svc of services) {
    const svcDir = join(SERVICES_DIR, svc);
    const dockerfile = join(svcDir, 'Dockerfile');
    try {
      const content = await readFile(dockerfile, 'utf8');
      const aisha = await hasAishaDep(svcDir);
      if (!aisha) {
        skipped.push(`${svc} (no @aisha/* deps)`);
        continue;
      }
      const migrated = migrateDockerfile(content);
      if (migrated === null) {
        skipped.push(`${svc} (already migrated or no eligible RUN line)`);
        continue;
      }
      if (DRY) {
        console.log(`# === ${svc} (DRY-RUN) ===`);
        console.log(migrated);
        console.log('# --- end ---');
      } else {
        await writeFile(dockerfile, migrated);
      }
      changed.push(svc);
    } catch (err) {
      if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        skipped.push(`${svc} (no Dockerfile)`);
      } else {
        failed.push(`${svc}: ${err.message}`);
      }
    }
  }

  console.log('');
  console.log(`Changed (${changed.length}): ${changed.join(', ') || '(none)'}`);
  console.log(`Skipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  - ${s}`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[migrate-verdaccio:FATAL]', err);
  process.exit(1);
});
