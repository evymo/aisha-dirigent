#!/usr/bin/env node
/**
 * Installs aisha-dirigent.vsix into all detected VS Code-compatible IDEs.
 *
 * Usage (from repo root):
 *   node scripts/ext-install.mjs          # build if needed, then install
 *   node scripts/ext-install.mjs --force  # force rebuild, then install
 *
 * Detected IDEs (first found wins per slot):
 *   VS Code        -> code
 *   VS Code Insiders -> code-insiders
 *   Cursor         -> cursor
 *   VSCodium       -> codium
 *   AISHA Workbench -> aisha-workbench
 *   Windsurf       -> windsurf
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const VSIX = resolve(REPO_ROOT, "tests/e2e-dirigent/.artifacts/aisha-dirigent.vsix");

const FORCE = process.argv.includes("--force");

// Helpers
function log(msg) {
  process.stdout.write(`[ext-install] ${msg}\n`);
}

function which(cmd) {
  const result = spawnSync("which", [cmd], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findExecutable(candidate) {
  const fromPath = which(candidate.cmd);
  if (fromPath) {
    return fromPath;
  }

  for (const fallback of candidate.fallbacks ?? []) {
    if (existsSync(fallback)) {
      return fallback;
    }
  }

  return null;
}

// Step 1: build VSIX if missing or --force
if (FORCE || !existsSync(VSIX)) {
  log("building VSIX...");
  execFileSync(
    "node",
    ["tests/e2e-dirigent/scripts/build-extension-vsix.mjs"],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, ...(FORCE ? { FORCE_REBUILD: "1" } : {}) },
    }
  );
} else {
  log(`VSIX up-to-date: ${VSIX}`);
}

// Step 2: detect IDEs
const IDE_CANDIDATES = [
  {
    cmd: "code",
    fallbacks: ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"],
  },
  {
    cmd: "code-insiders",
    fallbacks: [
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
    ],
  },
  {
    cmd: "cursor",
    fallbacks: ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
  },
  {
    cmd: "codium",
    fallbacks: ["/Applications/VSCodium.app/Contents/Resources/app/bin/codium"],
  },
  {
    cmd: "aisha-workbench",
    fallbacks: [
      "/Applications/AISHA Workbench.app/Contents/Resources/app/bin/aisha-workbench",
    ],
  },
  {
    cmd: "windsurf",
    fallbacks: ["/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"],
  },
];

const seen = new Set();
const found = IDE_CANDIDATES.map((candidate) => ({
  cmd: candidate.cmd,
  path: findExecutable(candidate),
}))
  .filter((entry) => entry.path !== null)
  .filter((entry) => {
    if (seen.has(entry.path)) {
      return false;
    }
    seen.add(entry.path);
    return true;
  });

if (found.length === 0) {
  log(
    "No VS Code-compatible IDE found (code / code-insiders / cursor / codium / aisha-workbench / windsurf)."
  );
  log(`Manual install: drag ${VSIX} onto Extensions sidebar, or run:`);
  log(`  <your-ide> --install-extension ${VSIX}`);
  process.exit(0);
}

// Step 3: install into each IDE
let ok = 0;
for (const { cmd, path: idePath } of found) {
  log(`installing into ${cmd} (${idePath})...`);
  const result = spawnSync(
    idePath,
    ["--install-extension", VSIX, "--force"],
    { encoding: "utf8", stdio: "inherit" }
  );
  if (result.status === 0) {
    log(`[ok] ${cmd}: installed`);
    ok++;
  } else {
    log(`[fail] ${cmd}: exit ${result.status}`);
  }
}

log(`done: installed into ${ok}/${found.length} IDE(s)`);
