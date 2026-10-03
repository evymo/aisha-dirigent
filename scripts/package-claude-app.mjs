#!/usr/bin/env node
/**
 * @module package-claude-app
 * Offline-capable builder for the AISHA Dirigent Claude app.
 *
 * Steps:
 *   1. Generate the packaging layer by invoking the SAME `claude-app` adapter
 *      that `gen:ide` uses (so output is identical), writing into
 *      `extensions/aisha-dirigent-claude/`. Uses the cached ruleset payload if
 *      present, else an empty payload — no backend required.
 *   2. Copy the Dirigent icon into the bundle.
 *   3. Validate the emitted manifest.json (MCPB) + plugin.json (Claude Code).
 *   4. Pack the MCP Bundle → `dist/claude-app/aisha-dirigent.mcpb` (a zip with
 *      manifest.json at the root, per the MCPB spec).
 *
 * Flags:
 *   --check        Generate + validate only; do not write the .mcpb (CI gate).
 *   --no-generate  Skip regeneration; pack whatever is on disk.
 *
 * Usage:
 *   node scripts/package-claude-app.mjs
 *   node scripts/package-claude-app.mjs --check
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, writeZip } from "./lib/mini-zip.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "extensions", "aisha-dirigent-claude");
const ICON_SRC = path.join(ROOT, "extensions", "aisha-dirigent", "resources", "icon.png");
const DIST_DIR = path.join(ROOT, "dist", "claude-app");

const flags = new Set(process.argv.slice(2));
const CHECK_ONLY = flags.has("--check");
const SKIP_GEN = flags.has("--no-generate");

/** MCPB bundle entries (relative to APP_DIR) — what goes inside the .mcpb zip. */
const BUNDLE_ENTRIES = ["manifest.json", "package.json", "README.md", "icon.png", "server"];

/** Console helper. */
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/** Load the cached payload if available; otherwise an empty payload. */
function loadPayload() {
  const cache = path.join(ROOT, ".aisha", "instruction-payload.json");
  if (existsSync(cache)) {
    try {
      return JSON.parse(readFileSync(cache, "utf-8"));
    } catch (err) {
      console.warn(`⚠️  ignoring unreadable instruction-payload cache (${err.message}); using an empty payload`);
    }
  }
  return { ruleset: { fingerprint: null }, generated_at: new Date().toISOString() };
}

/** Generate the packaging files via the adapter and write them to disk. */
async function generate() {
  const { generate: gen } = await import("./ide-adapters/adapter-claude-app.mjs");
  const out = await gen(loadPayload());
  let written = 0;
  for (const file of out.files) {
    const full = path.join(ROOT, file.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, file.content, "utf-8");
    written++;
  }
  log(`✓ generated ${written} files into ${path.relative(ROOT, APP_DIR)}/`);
}

/** Copy the Dirigent icon into the bundle. */
function copyIcon() {
  if (!existsSync(ICON_SRC)) {
    log(`! icon not found at ${path.relative(ROOT, ICON_SRC)} — bundle will have no icon`);
    return;
  }
  copyFileSync(ICON_SRC, path.join(APP_DIR, "icon.png"));
  log("✓ copied icon.png");
}

/** Validate the emitted manifests. Throws on a hard error. */
function validate() {
  const problems = [];

  // MCPB manifest.json
  const manifestPath = path.join(APP_DIR, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  for (const field of ["manifest_version", "name", "version", "description", "author", "server"]) {
    if (manifest[field] == null) problems.push(`manifest.json missing required field: ${field}`);
  }
  if (manifest.server) {
    if (manifest.server.type !== "node") problems.push("manifest.server.type must be 'node'");
    const entry = path.join(APP_DIR, manifest.server.entry_point || "");
    if (!existsSync(entry)) problems.push(`manifest.server.entry_point not found: ${manifest.server.entry_point}`);
  }
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    problems.push("manifest.tools is empty — server surface not captured");
  }

  // Claude Code plugin.json
  const pluginPath = path.join(APP_DIR, ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(pluginPath, "utf-8"));
  if (!plugin.name) problems.push("plugin.json missing required field: name");

  // .mcp.json
  const mcp = JSON.parse(readFileSync(path.join(APP_DIR, ".mcp.json"), "utf-8"));
  if (!mcp.mcpServers || !mcp.mcpServers["aisha-dirigent"]) {
    problems.push(".mcp.json missing mcpServers['aisha-dirigent']");
  }

  // Each declared tool must have a matching slash command file.
  for (const tool of manifest.tools) {
    const cmd = path.join(APP_DIR, "commands", `${tool.name.replace(/^aisha_/, "").replace(/_/g, "-")}.md`);
    if (!existsSync(cmd)) problems.push(`missing slash command for tool: ${tool.name}`);
  }

  if (problems.length) {
    throw new Error("Validation failed:\n  - " + problems.join("\n  - "));
  }
  log(`✓ validated manifest.json (${manifest.tools.length} tools), plugin.json, .mcp.json`);
  return manifest;
}

/** Pack the MCPB bundle into dist/claude-app/aisha-dirigent.mcpb (a zip). */
function pack(manifest) {
  mkdirSync(DIST_DIR, { recursive: true });
  const outFile = path.join(DIST_DIR, "aisha-dirigent.mcpb"); // writeZip truncates/overwrites

  const present = BUNDLE_ENTRIES.filter((e) => existsSync(path.join(APP_DIR, e)));
  const files = collectFiles(APP_DIR, present); // manifest.json lands at zip root
  const bytes = writeZip(outFile, files);
  const sizeKb = Math.round((bytes / 1024) * 10) / 10;
  log(`✓ packed ${path.relative(ROOT, outFile)} (${sizeKb} KB, ${files.length} files) — v${manifest.version}`);
}

async function main() {
  log("AISHA Dirigent → Claude app packager");
  if (!SKIP_GEN) await generate();
  copyIcon();
  const manifest = validate();
  if (CHECK_ONLY) {
    log("✓ --check passed (no .mcpb written)");
    return;
  }
  pack(manifest);
  log("\nNext:");
  log("  • Claude Desktop: install dist/claude-app/aisha-dirigent.mcpb (pick your AISHA workspace)");
  log("  • Claude Code:    claude plugin install ./extensions/aisha-dirigent-claude");
}

main().catch((err) => {
  console.error(`\n✗ ${err?.message || err}`);
  process.exit(1);
});
