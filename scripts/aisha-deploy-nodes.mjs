#!/usr/bin/env node
/**
 * AISHA Node Deploy Pipeline
 *
 * Full automated pipeline: pre-flight → build → test → deploy → verify.
 * Wraps the existing deploy-to-n8n.mjs with additional safety checks.
 *
 * @example
 *   npm run aisha:nodes:deploy              # default: Coolify deploy
 *   npm run aisha:nodes:deploy -- --local   # local ~/.n8n install
 *   npm run aisha:nodes:deploy -- --dry-run # tests only, no deploy
 */

import { execSync } from "child_process";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKGS_DIR = join(ROOT, "packages", "n8n-nodes-aisha");

const DRY_RUN = process.argv.includes("--dry-run");
const STRATEGY = process.argv.find(
  (a) => a === "--local" || a === "--coolify" || a === "--tarball" || a === "--api" || a === "--publish",
) || "--coolify";

// ─── Helpers ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = join(ROOT, ".env.aisha");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const N8N_URL = (
  process.env.N8N_WEBHOOK_URL ||
  env.N8N_URL ||
  ""
).replace(/\/$/, "");
if (!N8N_URL) {
  console.error(
    "ERROR: n8n URL not set — set N8N_WEBHOOK_URL or N8N_URL (env or .env.aisha). No hardcoded host allowed.",
  );
  process.exit(1);
}
const N8N_API_KEY = process.env.N8N_API_KEY || env.N8N_API_KEY || "";

// Dirigent workflow ID for the optional post-deploy verification step.
// Env-driven (no hardcoded upstream workflow ID): set N8N_DIRIGENT_WORKFLOW_ID
// in .env.aisha or the environment. When unset, the verification is skipped —
// the deploy itself does not depend on it.
const DIRIGENT_WORKFLOW_ID =
  process.env.N8N_DIRIGENT_WORKFLOW_ID || env.N8N_DIRIGENT_WORKFLOW_ID || "";

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, {
    stdio: "inherit",
    cwd: ROOT,
    timeout: 180_000,
    ...opts,
  });
}

function runSafe(cmd, opts = {}) {
  try {
    const output = execSync(cmd, {
      stdio: "pipe",
      encoding: "utf-8",
      cwd: ROOT,
      timeout: 120_000,
      ...opts,
    }).trim();
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: err.stderr || err.message };
  }
}

function step(msg) {
  console.log(`\n═══ ${msg} ═══`);
}

function abort(msg) {
  console.error(`\n❌ ABORT: ${msg}`);
  process.exit(1);
}

// ─── Pre-flight ──────────────────────────────────────────────────────────

function preflight() {
  step("1. Pre-flight Checks");

  // Verify package exists
  const pkgPath = join(PKGS_DIR, "package.json");
  if (!existsSync(pkgPath)) {
    abort("packages/n8n-nodes-aisha/package.json not found");
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  console.log(`  ✓ Package: ${pkg.name}@${pkg.version}`);

  // Verify source files exist
  const nodeFiles = [
    "nodes/AishaRpc/AishaRpc.node.ts",
    "nodes/AishaAudit/AishaAudit.node.ts",
    "nodes/AishaStoryManager/AishaStoryManager.node.ts",
    "nodes/AishaNodeFactory/AishaNodeFactory.node.ts",
  ];
  for (const f of nodeFiles) {
    if (!existsSync(join(PKGS_DIR, f))) {
      abort(`Missing node file: ${f}`);
    }
  }
  console.log(`  ✓ ${nodeFiles.length} node source files present`);

  // Verify deploy script
  const deployScript = join(PKGS_DIR, "scripts", "deploy-to-n8n.mjs");
  if (!existsSync(deployScript)) {
    abort("deploy-to-n8n.mjs not found");
  }
  console.log("  ✓ Deploy script available");

  return pkg;
}

// ─── TypeScript Build ────────────────────────────────────────────────────

function buildNodes() {
  step("2. TypeScript Build");
  const result = runSafe("npm run build", { cwd: PKGS_DIR });
  if (!result.ok) abort(`Build failed: ${result.output}`);
  console.log("  ✓ Build successful");
}

// ─── Unit Tests ──────────────────────────────────────────────────────────

function runTests() {
  step("3. Unit Tests");

  // Community node tests
  const nodeTests = runSafe("npx vitest run --reporter=verbose 2>&1", {
    cwd: PKGS_DIR,
  });
  const passMatch = nodeTests.output.match(/(\d+)\s+passed/);
  const failMatch = nodeTests.output.match(/(\d+)\s+failed/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;

  if (!nodeTests.ok || failed > 0) {
    console.error(nodeTests.output);
    abort(`Tests failed: ${passed} passed, ${failed} failed`);
  }
  console.log(`  ✓ Community node tests: ${passed} passed`);

  // MCP tests
  const mcpTests = runSafe("npx vitest run src/tests/mcp/ 2>&1");
  const mcpPass = mcpTests.output.match(/(\d+)\s+passed/);
  const mcpFail = mcpTests.output.match(/(\d+)\s+failed/);
  const mcpPassed = mcpPass ? parseInt(mcpPass[1]) : 0;
  const mcpFailed = mcpFail ? parseInt(mcpFail[1]) : 0;

  if (!mcpTests.ok || mcpFailed > 0) {
    console.error(mcpTests.output);
    abort(`MCP tests failed: ${mcpPassed} passed, ${mcpFailed} failed`);
  }
  console.log(`  ✓ MCP tests: ${mcpPassed} passed`);
}

// ─── Deploy ──────────────────────────────────────────────────────────────

function deployNodes() {
  if (DRY_RUN) {
    step("4. Deploy (DRY RUN — skipped)");
    console.log("  ℹ Would deploy with strategy:", STRATEGY);
    return;
  }

  step(`4. Deploy (${STRATEGY})`);
  run(`node scripts/deploy-to-n8n.mjs ${STRATEGY}`, { cwd: PKGS_DIR });
}

// ─── Post-deploy Verification ────────────────────────────────────────────

async function verify(pkg) {
  if (DRY_RUN) {
    step("5. Verification (DRY RUN — skipped)");
    return;
  }

  step("5. Post-deploy Verification");

  // Wait for n8n to reload
  console.log("  ⏳ Waiting 5s for n8n to reload...");
  await new Promise((r) => setTimeout(r, 5000));

  // Health check
  try {
    const resp = await fetch(`${N8N_URL}/healthz`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      console.log("  ✓ n8n health: OK");
    } else {
      console.log(`  ⚠ n8n health: HTTP ${resp.status}`);
    }
  } catch (err) {
    console.log(`  ⚠ n8n unreachable: ${err.message}`);
  }

  // Verify the Dirigent workflow is active (optional — env-driven workflow ID).
  if (N8N_API_KEY && DIRIGENT_WORKFLOW_ID) {
    try {
      const resp = await fetch(
        `${N8N_URL}/api/v1/workflows/${DIRIGENT_WORKFLOW_ID}`,
        {
          headers: { "X-N8N-API-KEY": N8N_API_KEY },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (resp.ok) {
        const wf = await resp.json();
        console.log(
          `  ✓ Dirigent workflow: ${wf.active ? "active" : "INACTIVE"}`,
        );
      }
    } catch {
      console.log("  ⚠ Could not verify Dirigent workflow");
    }
  } else if (N8N_API_KEY && !DIRIGENT_WORKFLOW_ID) {
    console.log(
      "  ⓘ Skipping Dirigent workflow check — set N8N_DIRIGENT_WORKFLOW_ID to enable",
    );
  }

  console.log(`  ✓ Deployed: ${pkg.name}@${pkg.version}`);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        AISHA Node Deploy Pipeline                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Strategy: ${STRATEGY}${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`  n8n URL:  ${N8N_URL}\n`);

  const pkg = preflight();
  buildNodes();
  runTests();
  deployNodes();
  await verify(pkg);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(
    DRY_RUN
      ? "  ✅ Dry run complete — all checks passed!"
      : `  ✅ Pipeline complete — ${pkg.name}@${pkg.version} deployed!`,
  );
  console.log("");
}

main().catch((err) => {
  console.error(`\n💥 Pipeline error: ${err.message}`);
  process.exit(1);
});
