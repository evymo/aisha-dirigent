#!/usr/bin/env node

/**
 * @module generate-capability-catalog
 * CLI entrypoint that regenerates the AISHA capability catalog ("adresář")
 * from the git working tree.
 *
 * Outputs:
 *   docs/catalog/capabilities.json — machine-readable inventory (KB-ingestable)
 *   docs/catalog/index.md          — human-readable adresář (co / k čemu / jak)
 *
 * Single source of truth is the repo itself, so AISHA keeps the catalog current
 * by re-running this on change (husky/CI) instead of anyone hand-editing it.
 *
 * Usage:
 *   node scripts/generate-capability-catalog.mjs [options]
 *
 * Options:
 *   --check       Verify the committed catalog matches a fresh scan. Exit 1 on
 *                 drift. Use as a CI gate. Writes nothing.
 *   --dry-run     Print what would be written without touching disk.
 *   --json-only   Regenerate only capabilities.json (skip the Markdown adresář).
 *   --list        Print scanned categories and counts, then exit.
 *   --help        Show this help.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { safeWriteSync } from "./lib/ide-instructions-safety.mjs";
import {
  CATEGORIES,
  coresEqual,
  renderJson,
  renderMarkdown,
  scanCapabilities,
} from "./lib/capability-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const OUT_DIR = "docs/catalog";
const JSON_REL = `${OUT_DIR}/capabilities.json`;
const MD_REL = `${OUT_DIR}/index.md`;
const REGEN_COMMAND = "npm run gen:catalog";

/** Mirror generate-ide-instructions.mjs: ignore the volatile timestamp line. */
function stripVolatile(content) {
  return content
    .replace(/^> Generated: .+$/m, "")
    .replace(/<!-- gen:metadata .+ -->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parse committed capabilities.json and drop the volatile generatedAt field. */
function loadCommittedCore(jsonPath) {
  if (!existsSync(jsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
    delete parsed.generatedAt;
    return parsed;
  } catch {
    return null;
  }
}

function parseFlags(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) flags[arg.slice(2)] = true;
  }
  return flags;
}

function printHelp() {
  process.stdout.write(
    `Regenerate the AISHA capability catalog from the git working tree.\n\n` +
      `Usage: node scripts/generate-capability-catalog.mjs [options]\n\n` +
      `  --check       Fail (exit 1) if the committed catalog is stale. CI gate.\n` +
      `  --dry-run     Print planned writes without touching disk.\n` +
      `  --json-only   Regenerate only ${JSON_REL}.\n` +
      `  --list        Print categories and counts, then exit.\n` +
      `  --help        Show this help.\n`,
  );
}

function main() {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    return;
  }

  const core = scanCapabilities(ROOT);

  if (flags.list) {
    process.stdout.write("Capability catalog — categories:\n");
    for (const c of CATEGORIES) {
      process.stdout.write(`  ${c.id.padEnd(16)} ${String(core.summary[c.id]).padStart(4)}  ${c.title}\n`);
    }
    process.stdout.write(`  ${"total".padEnd(16)} ${String(core.summary.total).padStart(4)}\n`);
    return;
  }

  const generatedAt = new Date().toISOString();
  const jsonStr = renderJson(core, { generatedAt });
  const mdStr = renderMarkdown(core, { generatedAt, regenCommand: REGEN_COMMAND });

  const jsonPath = path.join(ROOT, JSON_REL);
  const mdPath = path.join(ROOT, MD_REL);

  // --- CI gate: verify, never write -------------------------------------
  if (flags.check) {
    const problems = [];
    const committedCore = loadCommittedCore(jsonPath);
    if (!committedCore) {
      problems.push(`${JSON_REL} missing or unparseable`);
    } else if (!coresEqual(committedCore, core)) {
      problems.push(`${JSON_REL} is stale`);
    }
    if (!flags["json-only"]) {
      const committedMd = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : null;
      if (committedMd == null) {
        problems.push(`${MD_REL} missing`);
      } else if (stripVolatile(committedMd) !== stripVolatile(mdStr)) {
        problems.push(`${MD_REL} is stale`);
      }
    }
    if (problems.length > 0) {
      process.stderr.write(`Capability catalog out of date:\n`);
      for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
      process.stderr.write(`Run \`${REGEN_COMMAND}\` and commit the result.\n`);
      process.exit(1);
    }
    process.stdout.write(`✓ Capability catalog up to date (${core.summary.total} items).\n`);
    return;
  }

  // --- dry run ----------------------------------------------------------
  if (flags["dry-run"]) {
    process.stdout.write(`[dry-run] ${JSON_REL} (${jsonStr.length} chars)\n`);
    if (!flags["json-only"]) process.stdout.write(`[dry-run] ${MD_REL} (${mdStr.length} chars)\n`);
    process.stdout.write(`[dry-run] ${core.summary.total} items across ${CATEGORIES.length} categories\n`);
    return;
  }

  // --- write ------------------------------------------------------------
  if (!existsSync(path.join(ROOT, OUT_DIR))) {
    mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  }

  // capabilities.json: skip rewrite when only the timestamp would change.
  const committedCore = loadCommittedCore(jsonPath);
  if (committedCore && coresEqual(committedCore, core)) {
    process.stdout.write(`  = ${JSON_REL} (unchanged)\n`);
  } else {
    writeFileSync(jsonPath, jsonStr);
    process.stdout.write(`  ✓ ${JSON_REL} (${jsonStr.length} chars)\n`);
  }

  // index.md: safeWriteSync preserves the user-section and backs up.
  if (!flags["json-only"]) {
    const outcome = safeWriteSync(ROOT, MD_REL, mdStr, (a, b) => stripVolatile(a) === stripVolatile(b));
    switch (outcome.outcome) {
      case "skipped-identical":
        process.stdout.write(`  = ${MD_REL} (unchanged)\n`);
        break;
      case "refused-user-owned":
        process.stderr.write(`  ! ${MD_REL} (refused — user-owned, no AISHA header)\n`);
        break;
      case "backup-failed":
        process.stderr.write(`  ✗ ${MD_REL} (backup failed)\n`);
        break;
      default: {
        const tag = outcome.preservedUserSection ? " (user-section preserved)" : "";
        process.stdout.write(`  ✓ ${MD_REL} (${mdStr.length} chars)${tag}\n`);
      }
    }
  }

  process.stdout.write(`Catalog: ${core.summary.total} items across ${CATEGORIES.length} categories.\n`);
}

main();
