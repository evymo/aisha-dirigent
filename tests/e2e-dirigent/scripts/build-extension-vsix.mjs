#!/usr/bin/env node
/**
 * Builds aisha-dirigent extension VSIX into tests/e2e-dirigent/.artifacts/
 * so the Dockerfile.code-server image can install it.
 *
 * Run from repo root or from tests/e2e-dirigent/.
 * Idempotent: skips if VSIX is newer than extension source.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");
const EXT_DIR = join(REPO_ROOT, "extensions/aisha-dirigent");
const ARTIFACTS_DIR = resolve(__dirname, "../.artifacts");
const OUT_VSIX = join(ARTIFACTS_DIR, "aisha-dirigent.vsix");

function log(msg) {
   
  console.log(`[build-extension-vsix] ${msg}`);
}

function newestMtimeUnder(dir, ignore = /node_modules|dist|\.vsix$/) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignore.test(entry.name)) continue;
    const p = join(dir, entry.name);
    const s = statSync(p);
    if (s.isDirectory()) {
      newest = Math.max(newest, newestMtimeUnder(p, ignore));
    } else {
      newest = Math.max(newest, s.mtimeMs);
    }
  }
  return newest;
}

function shouldRebuild() {
  if (process.env.FORCE_REBUILD === "1") return true;
  if (!existsSync(OUT_VSIX)) return true;
  const vsixMtime = statSync(OUT_VSIX).mtimeMs;
  const srcNewest = newestMtimeUnder(join(EXT_DIR, "src"));
  return srcNewest > vsixMtime;
}

function main() {
  if (!shouldRebuild()) {
    log(`up-to-date — skipping (use FORCE_REBUILD=1 to force)`);
    log(`VSIX: ${OUT_VSIX}`);
    return;
  }

  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  log(`building VSIX from ${EXT_DIR}`);
  // Compile (esbuild bundles templates via text loader)
  execFileSync("npm", ["run", "compile"], { cwd: EXT_DIR, stdio: "inherit" });

  // Package — vsce emits aisha-dirigent-<version>.vsix in EXT_DIR
  // Clean previous to avoid version-pick race
  for (const f of readdirSync(EXT_DIR)) {
    if (f.endsWith(".vsix")) rmSync(join(EXT_DIR, f));
  }
  execFileSync("npx", ["@vscode/vsce", "package", "--no-dependencies", "--no-yarn"], {
    cwd: EXT_DIR,
    stdio: "inherit",
  });

  const produced = readdirSync(EXT_DIR).find((f) => f.endsWith(".vsix"));
  if (!produced) {
    throw new Error("vsce package produced no .vsix file");
  }
  copyFileSync(join(EXT_DIR, produced), OUT_VSIX);
  rmSync(join(EXT_DIR, produced));
  log(`built: ${OUT_VSIX}`);
}

main();
