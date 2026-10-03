#!/usr/bin/env node

/**
 * @module company-os/cli
 * AISHA Company OS CLI — scaffold and generate the customizable agent fleet
 * (docs/AISHA_COMPANY_OS.md).
 *
 * Usage:
 *   node scripts/company-os/cli.mjs init [--preset=<name>] [--list-presets] [--force]
 *   node scripts/company-os/cli.mjs gen [--dry-run]
 *   node scripts/company-os/cli.mjs check
 *   node scripts/company-os/cli.mjs agent-spec <slug>
 *
 * npm aliases: company-os:init, gen:company-os, gen:company-os:check,
 * company-os:agent-spec.
 *
 * `check` exits 0 in repos without a company-os/ instance so it is safe in
 * shared CI pipelines.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeWriteSync } from "../lib/ide-instructions-safety.mjs";
import {
  BRAIN_DIR,
  BRAIN_TEMPLATES_DIR,
  FLEET_FILE,
  PRESETS_DIR,
  emitAgentSpec,
  expectedOnDisk,
  findStaleArtifacts,
  fleetFingerprint,
  generateFleet,
  loadManifest,
  scanBrainForSecrets,
  validateManifest,
} from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Where presets, brain templates, and the schema live — always this repo. */
const ASSETS_ROOT = path.resolve(__dirname, "..", "..");
/**
 * Where the instance (company-os/, .claude/) is read and written. Defaults to
 * this repo; overridable for tests and for generating into another workspace.
 */
const ROOT = process.env.AISHA_COMPANY_OS_ROOT
  ? path.resolve(process.env.AISHA_COMPANY_OS_ROOT)
  : ASSETS_ROOT;

const out = (line = "") => process.stdout.write(`${line}\n`);
const err = (line = "") => process.stderr.write(`${line}\n`);

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) flags[arg.slice(2)] = true;
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function listPresets() {
  const dir = path.join(ASSETS_ROOT, PRESETS_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function printProblems({ errors, warnings }) {
  for (const w of warnings) out(`  WARN  ${w}`);
  for (const e of errors) err(`  ERROR ${e}`);
}

/** Load + validate the repo's fleet manifest, exiting non-zero on problems. */
function loadValidatedFleet({ requireBrain = true } = {}) {
  const manifest = loadManifest(path.join(ROOT, FLEET_FILE));
  const result = validateManifest(manifest, {
    brainDir: requireBrain ? path.join(ROOT, BRAIN_DIR) : undefined,
  });
  printProblems(result);
  if (result.errors.length > 0) {
    err(`\n${FLEET_FILE} failed validation (${result.errors.length} error(s)).`);
    process.exit(1);
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function cmdInit(flags) {
  if (flags["list-presets"]) {
    out("Available presets:");
    for (const p of listPresets()) out(`  - ${p}`);
    return;
  }

  const presetName = typeof flags.preset === "string" ? flags.preset : "one-person-company";
  const presetPath = path.join(ASSETS_ROOT, PRESETS_DIR, `${presetName}.json`);
  if (!existsSync(presetPath)) {
    err(`Unknown preset "${presetName}". Available: ${listPresets().join(", ")}`);
    process.exit(1);
  }

  const preset = loadManifest(presetPath);
  const presetResult = validateManifest(preset);
  if (presetResult.errors.length > 0) {
    printProblems(presetResult);
    err(`Preset ${presetName} is invalid — fix ${PRESETS_DIR}/${presetName}.json first.`);
    process.exit(1);
  }

  const fleetAbs = path.join(ROOT, FLEET_FILE);
  const brainAbs = path.join(ROOT, BRAIN_DIR);
  mkdirSync(brainAbs, { recursive: true });

  // fleet.json — refuse to clobber an existing fleet unless --force.
  if (existsSync(fleetAbs) && !flags.force) {
    out(`skip   ${FLEET_FILE} (exists — use --force to overwrite)`);
  } else {
    // Instance lives one level below repo root → adjust the $schema pointer.
    const instance = { ...preset, $schema: "../schemas/company-os-fleet.schema.json" };
    writeFileSync(fleetAbs, `${JSON.stringify(instance, null, 2)}\n`);
    out(`write  ${FLEET_FILE} (preset: ${presetName})`);
  }

  // Brain templates — only ever fill gaps; user brain files are never touched.
  const templatesAbs = path.join(ASSETS_ROOT, BRAIN_TEMPLATES_DIR);
  for (const tpl of readdirSync(templatesAbs).filter((f) => f.endsWith(".md")).sort()) {
    const target = path.join(brainAbs, tpl);
    if (existsSync(target)) {
      out(`skip   ${BRAIN_DIR}/${tpl} (exists)`);
    } else {
      copyFileSync(path.join(templatesAbs, tpl), target);
      out(`write  ${BRAIN_DIR}/${tpl}`);
    }
  }

  out("\nNext steps:");
  out(`  1. Fill in ${BRAIN_DIR}/*.md — the brain makes the agents useful.`);
  out(`  2. Tune ${FLEET_FILE} (agents, slots, autonomy, MCP tools).`);
  out("  3. npm run gen:company-os");
}

// ---------------------------------------------------------------------------
// gen / check
// ---------------------------------------------------------------------------

function cmdGen(flags) {
  const manifest = loadValidatedFleet();
  for (const w of scanBrainForSecrets(path.join(ROOT, BRAIN_DIR))) out(`  WARN  ${w}`);

  const { files } = generateFleet(manifest);
  out(`Fleet fingerprint: ${fleetFingerprint(manifest)} — ${files.length} artifact(s)`);

  for (const file of files) {
    if (flags["dry-run"]) {
      out(`plan   ${file.path}`);
      continue;
    }
    const result = safeWriteSync(ROOT, file.path, file.content, (a, b) => a === b);
    out(`${result.outcome.padEnd(20)} ${file.path}${result.preservedUserSection ? "  (user section preserved)" : ""}`);
    if (result.outcome === "refused-user-owned") {
      err(`  ERROR ${file.path} exists without the auto-gen marker — move your content into the user section or delete the file, then rerun.`);
      process.exitCode = 1;
    }
  }

  const stale = findStaleArtifacts(ROOT, new Set(files.map((f) => f.path)));
  if (stale.length > 0) {
    out("\nStale Company OS artifacts (agent removed/renamed in the manifest?) — review and delete manually:");
    for (const s of stale) out(`  stale  ${s}`);
  }
}

function cmdCheck() {
  if (!existsSync(path.join(ROOT, FLEET_FILE))) {
    out(`No ${FLEET_FILE} — Company OS not initialized in this repo, nothing to check.`);
    return;
  }
  const manifest = loadValidatedFleet();
  const { files } = generateFleet(manifest);

  const drifted = [];
  for (const file of files) {
    const abs = path.join(ROOT, file.path);
    if (!existsSync(abs)) {
      drifted.push(`${file.path} (missing)`);
      continue;
    }
    const existing = readFileSync(abs, "utf-8");
    if (existing !== expectedOnDisk(file.content, existing)) {
      drifted.push(`${file.path} (stale)`);
    }
  }

  const stale = findStaleArtifacts(ROOT, new Set(files.map((f) => f.path)));
  for (const s of stale) drifted.push(`${s} (orphaned)`);

  if (drifted.length > 0) {
    err(`Company OS artifacts drifted from ${FLEET_FILE}:`);
    for (const d of drifted) err(`  - ${d}`);
    err("Run: npm run gen:company-os");
    process.exit(1);
  }
  out(`Company OS artifacts in sync (${files.length} file(s), fingerprint ${fleetFingerprint(manifest)}).`);
}

// ---------------------------------------------------------------------------
// agent-spec
// ---------------------------------------------------------------------------

function cmdAgentSpec(positional) {
  const slug = positional[0];
  if (!slug) {
    err("Usage: npm run company-os:agent-spec -- <slug>");
    process.exit(1);
  }
  const manifest = loadValidatedFleet({ requireBrain: false });
  const spec = emitAgentSpec(manifest, slug);
  err(`# agent_spec draft for "${slug}" — starting point for plugin_catalog.agent_spec`);
  err("# (publish_agent → materialize_agent_runtime / install_agent_as_story; review before publishing)");
  out(JSON.stringify(spec, null, 2));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function printHelp() {
  out("AISHA Company OS — customizable agent fleet (docs/AISHA_COMPANY_OS.md)");
  out("");
  out("Commands:");
  out("  init [--preset=<name>] [--list-presets] [--force]   scaffold company-os/ from a preset");
  out("  gen [--dry-run]                                      generate .claude agents/commands + agent map");
  out("  check                                                CI drift check (no-op without an instance)");
  out("  agent-spec <slug>                                    emit plugin_catalog.agent_spec draft");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);

  try {
    switch (command) {
      case "init": return cmdInit(flags);
      case "gen": return cmdGen(flags);
      case "check": return cmdCheck();
      case "agent-spec": return cmdAgentSpec(positional);
      case undefined:
      case "help":
      case "--help": return printHelp();
      default:
        err(`Unknown command: ${command}\n`);
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    err(`ERROR ${e.message}`);
    process.exit(1);
  }
}

main();
