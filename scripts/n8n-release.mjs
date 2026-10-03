#!/usr/bin/env node
// =============================================================================
// n8n-release.mjs — Automated release pipeline for n8n-nodes-aisha
// =============================================================================
//
// Full pipeline: test → build → version bump → publish to Verdaccio → restart n8n
//
// Commands:
//   node scripts/n8n-release.mjs              # Full release (patch bump)
//   node scripts/n8n-release.mjs --minor      # Minor version bump
//   node scripts/n8n-release.mjs --major      # Major version bump
//   node scripts/n8n-release.mjs --publish    # Build + publish only (no restart)
//   node scripts/n8n-release.mjs --restart    # Restart n8n only (no build/publish)
//   node scripts/n8n-release.mjs --status     # Show current status
//   node scripts/n8n-release.mjs --dry-run    # Simulate everything
//
// Environment (from .env.aisha):
//   VERDACCIO_TOKEN    — JWT for npm publish
//   N8N_API_KEY        — n8n REST API key
//   COOLIFY_API_TOKEN  — Coolify API Bearer token
//
// NPM scripts:
//   npm run n8n:release          # Full release (patch)
//   npm run n8n:release:minor    # Minor bump
//   npm run n8n:publish          # Publish only
//   npm run n8n:restart          # Restart only
//   npm run n8n:status           # Status check
// =============================================================================

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG_DIR = join(ROOT, "packages", "n8n-nodes-aisha");
const ENV_PATH = join(ROOT, ".env.aisha");

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PUBLISH_ONLY = args.includes("--publish");
const RESTART_ONLY = args.includes("--restart");
const STATUS_ONLY = args.includes("--status");
const BUMP_TYPE = args.includes("--major")
  ? "major"
  : args.includes("--minor")
    ? "minor"
    : "patch";

// ── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = loadEnv();
const VERDACCIO_TOKEN =
  process.env.VERDACCIO_TOKEN || fileEnv.VERDACCIO_TOKEN || "";
const N8N_URL = (
  process.env.N8N_URL ||
  process.env.N8N_WEBHOOK_URL ||
  fileEnv.N8N_WEBHOOK_URL ||
  fileEnv.N8N_URL ||
  ""
).replace(/\/$/, "");
const N8N_API_KEY =
  process.env.N8N_API_KEY || fileEnv.N8N_API_KEY || "";
const COOLIFY_API_TOKEN =
  process.env.COOLIFY_API_TOKEN || fileEnv.COOLIFY_API_TOKEN || "";
const COOLIFY_URL = (() => {
  const v = process.env.COOLIFY_URL || fileEnv.COOLIFY_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_URL required\n"); process.exit(2); }
  return v;
})();
const N8N_COOLIFY_UUID =
  process.env.N8N_COOLIFY_UUID ||
  fileEnv.N8N_COOLIFY_UUID ||
  "u00woowgoc8owwww8kcs84g0";
const VERDACCIO_URL =
  process.env.VERDACCIO_URL || fileEnv.VERDACCIO_URL || "";

// ── Helpers ─────────────────────────────────────────────────────────────────
const isCI = !!process.env.CI;
const c = {
  green: (s) => (isCI ? s : `\x1b[32m${s}\x1b[0m`),
  red: (s) => (isCI ? s : `\x1b[31m${s}\x1b[0m`),
  yellow: (s) => (isCI ? s : `\x1b[33m${s}\x1b[0m`),
  cyan: (s) => (isCI ? s : `\x1b[36m${s}\x1b[0m`),
  dim: (s) => (isCI ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s) => (isCI ? s : `\x1b[1m${s}\x1b[0m`),
};

function step(msg) {
  console.log(`\n${c.bold(`═══ ${msg} ═══`)}`);
}

function ok(msg) {
  console.log(`  ${c.green("✓")} ${msg}`);
}

function warn(msg) {
  console.log(`  ${c.yellow("⚠")} ${msg}`);
}

function fail(msg) {
  console.error(`\n  ${c.red("✗")} ${msg}`);
}

function abort(msg) {
  fail(msg);
  process.exit(1);
}

function run(cmd, opts = {}) {
  if (DRY_RUN) {
    console.log(`  ${c.dim(`[DRY] $ ${cmd}`)}`);
    return "";
  }
  console.log(`  ${c.dim(`$ ${cmd}`)}`);
  return execSync(cmd, {
    stdio: "pipe",
    encoding: "utf-8",
    cwd: opts.cwd || ROOT,
    timeout: opts.timeout || 120_000,
    env: { ...process.env, VERDACCIO_TOKEN },
  }).trim();
}

function readPkg() {
  return JSON.parse(
    readFileSync(join(PKG_DIR, "package.json"), "utf-8"),
  );
}

// ── Status ──────────────────────────────────────────────────────────────────
async function showStatus() {
  step("n8n-nodes-aisha Status");

  // Local version
  const pkg = readPkg();
  console.log(`  Local version:    ${c.cyan(pkg.version)}`);

  // Verdaccio version
  try {
    const output = execSync(
      `npm view n8n-nodes-aisha version --registry ${VERDACCIO_URL}/`,
      { encoding: "utf-8", timeout: 15_000 },
    ).trim();
    console.log(`  Verdaccio latest: ${c.cyan(output)}`);
  } catch (err) {
    console.warn("[n8n-release] Verdaccio unreachable:", err.message);
    warn("Cannot reach Verdaccio");
  }

  // n8n health
  try {
    const resp = await fetch(`${N8N_URL}/healthz`, {
      signal: AbortSignal.timeout(10_000),
    });
    ok(`n8n health: ${resp.ok ? "OK" : `HTTP ${resp.status}`}`);
  } catch (err) {
    console.warn("[n8n-release] n8n /healthz unreachable:", err.message);
    warn("n8n unreachable");
  }

  // Installed version in n8n (via community packages API)
  if (N8N_API_KEY) {
    try {
      const resp = await fetch(
        `${N8N_URL}/api/v1/community-packages`,
        {
          headers: { "X-N8N-API-KEY": N8N_API_KEY },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (resp.ok) {
        const pkgs = await resp.json();
        const evymo = Array.isArray(pkgs)
          ? pkgs.find((p) => p.packageName === "n8n-nodes-aisha")
          : null;
        if (evymo) {
          console.log(
            `  n8n installed:    ${c.cyan(evymo.installedVersion)} (${evymo.installedNodes?.length ?? "?"} nodes)`,
          );
        } else {
          console.log(
            `  n8n installed:    ${c.dim("via N8N_CUSTOM_EXTENSIONS (not community API)")}`,
          );
        }
      }
    } catch {
      // community-packages endpoint missing (older n8n, custom extensions only)
      // — informational only, downstream code handles absent version gracefully
    }
  }
}

// ── Test ─────────────────────────────────────────────────────────────────────
function runTests() {
  step("1. Running Tests");

  try {
    const output = run("npx vitest run --reporter=verbose 2>&1", {
      cwd: PKG_DIR,
      timeout: 60_000,
    });
    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;

    if (failed > 0) {
      abort(`Tests failed: ${passed} passed, ${failed} failed`);
    }
    ok(`${passed} tests passed`);
  } catch (err) {
    if (DRY_RUN) {
      ok("Tests (dry run)");
      return;
    }
    abort(`Tests failed: ${err.message}`);
  }
}

// ── Build ───────────────────────────────────────────────────────────────────
function buildPackage() {
  step("2. Building Package");
  run("npm run build", { cwd: PKG_DIR });
  ok("TypeScript build complete");
}

// ── Bump ────────────────────────────────────────────────────────────────────
function bumpVersion() {
  step(`3. Version Bump (${BUMP_TYPE})`);

  const before = readPkg().version;
  run(`npm version ${BUMP_TYPE} --no-git-tag-version`, { cwd: PKG_DIR });
  const after = DRY_RUN ? `${before}+1` : readPkg().version;

  ok(`${before} → ${after}`);
  return after;
}

// ── Publish ─────────────────────────────────────────────────────────────────
function publishToVerdaccio() {
  step("4. Publishing to Verdaccio");

  if (!VERDACCIO_TOKEN) {
    abort(
      "VERDACCIO_TOKEN not set. Add to .env.aisha or export as env var.",
    );
  }

  const pkg = readPkg();

  try {
    run(
      `npm publish ./packages/n8n-nodes-aisha --registry ${VERDACCIO_URL}/`,
      { timeout: 60_000 },
    );
    ok(`Published ${pkg.name}@${pkg.version}`);
  } catch (err) {
    // E409 = version already exists — not fatal
    if (err.message?.includes("409") || err.stderr?.includes("409")) {
      warn(`${pkg.version} already on Verdaccio — continuing`);
    } else {
      abort(`Publish failed: ${err.message}`);
    }
  }
}

// ── Restart n8n ─────────────────────────────────────────────────────────────
async function restartN8n() {
  step("5. Restarting n8n");

  if (!COOLIFY_API_TOKEN) {
    warn(
      "COOLIFY_API_TOKEN not set — cannot auto-restart.\n" +
      "  Add to .env.aisha or restart manually from Coolify dashboard.",
    );
    return false;
  }

  if (DRY_RUN) {
    ok("Would restart n8n via Coolify API (dry run)");
    return true;
  }

  try {
    const resp = await fetch(
      `${COOLIFY_URL}/api/v1/applications/${N8N_COOLIFY_UUID}/restart`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${COOLIFY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      warn(`Coolify restart returned ${resp.status}: ${body.slice(0, 200)}`);
      return false;
    }

    ok("Restart triggered via Coolify API");
    return true;
  } catch (err) {
    warn(`Coolify API error: ${err.message}`);
    return false;
  }
}

// ── Wait & Verify ───────────────────────────────────────────────────────────
async function waitAndVerify() {
  step("6. Verification");

  if (DRY_RUN) {
    ok("Would verify n8n health + installed version (dry run)");
    return;
  }

  // Wait for n8n bootstrap (entrypoint installs packages)
  const WAIT_SECONDS = 90;
  console.log(
    `  Waiting ${WAIT_SECONDS}s for n8n bootstrap...`,
  );

  for (let i = 0; i < WAIT_SECONDS; i += 15) {
    await new Promise((r) => setTimeout(r, 15_000));
    process.stdout.write(
      `  ${c.dim(`${i + 15}s...`)} `,
    );

    try {
      const resp = await fetch(`${N8N_URL}/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        console.log("");
        ok("n8n is healthy");

        // Check installed version
        const pkg = readPkg();
        try {
          const verdaccioVer = execSync(
            `npm view n8n-nodes-aisha version --registry ${VERDACCIO_URL}/`,
            { encoding: "utf-8", timeout: 10_000 },
          ).trim();
          ok(`Verdaccio has ${pkg.name}@${verdaccioVer}`);
        } catch {
          // Verdaccio version check is a courtesy ack — absent registry doesn't
          // block the overall release flow because the publish succeeded.
        }

        return;
      }
    } catch {
      // n8n still starting (waitForN8n loop) — keep polling silently.
    }
  }

  console.log("");
  warn(
    `n8n not healthy after ${WAIT_SECONDS}s — check Coolify logs`,
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(
    c.bold(
      "\n╔══════════════════════════════════════════════════════════╗",
    ),
  );
  console.log(
    c.bold(
      "║       n8n-nodes-aisha Release Pipeline                  ║",
    ),
  );
  console.log(
    c.bold(
      "╚══════════════════════════════════════════════════════════╝",
    ),
  );

  if (DRY_RUN) {
    console.log(c.yellow("  [DRY RUN MODE]"));
  }

  // ── Status only ──
  if (STATUS_ONLY) {
    await showStatus();
    return;
  }

  // ── Restart only ──
  if (RESTART_ONLY) {
    const restarted = await restartN8n();
    if (restarted) {
      await waitAndVerify();
    }
    return;
  }

  // ── Build + Publish (+ optional restart) ──
  runTests();
  buildPackage();
  bumpVersion();
  publishToVerdaccio();

  if (!PUBLISH_ONLY) {
    const restarted = await restartN8n();
    if (restarted) {
      await waitAndVerify();
    }
  }

  // ── Summary ──
  const pkg = readPkg();
  console.log(
    `\n${c.bold("═══════════════════════════════════════════════════════════")}`,
  );
  console.log(
    DRY_RUN
      ? c.green(
          `  ✅ Dry run complete — would release ${pkg.name}@${pkg.version}`,
        )
      : c.green(
          `  ✅ Released ${pkg.name}@${pkg.version}${PUBLISH_ONLY ? " (publish only)" : ""}`,
        ),
  );
  console.log("");
}

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});
