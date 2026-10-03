#!/usr/bin/env node

/**
 * @module generate-ide-instructions
 * CLI entrypoint for generating IDE instruction files from AISHA knowledge base.
 *
 * Usage:
 *   node scripts/generate-ide-instructions.mjs [options]
 *
 * Options:
 *   --format=<id>       Generate only specific adapter (see --list for available adapters)
 *   --all               Generate all adapters (default)
 *   --story-id=<uuid>   Override story ID (default: reads from .aisha/story.json)
 *   --offline            Use cached payload from .aisha/instruction-payload.json
 *   --save-payload       Save fetched payload to cache for offline use
 *   --dry-run            Print output paths without writing files
 *   --list               List available adapters
 *   --help               Show this help
 *
 * Environment:
 *   AISHA_POSTGREST_SERVICE_KEY or VITE_AISHA_GATEWAY_KEY — required for online mode
 *   AISHA_POSTGREST_URL — override API URL (default: http://127.0.0.1:3001)
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { safeWriteSync } from "./lib/ide-instructions-safety.mjs";
import { isMultiFileOutput, mergeSettingsJson } from "./ide-adapters/multi-file.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Strip volatile fields (generated_at timestamps) from content for comparison.
 * This prevents unnecessary file rewrites when only the timestamp changed.
 */
function stripVolatile(content) {
  return content
    .replace(/^> Generated: .+$/m, "")
    .replace(/<!-- gen:metadata .+ -->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Dynamic imports to avoid loading all adapters upfront
async function loadAdapter(adapterId) {
  const mod = await import(`./ide-adapters/adapter-${adapterId}.mjs`);
  return mod;
}

/**
 * Load IDE adapter preferences from .aisha/dirigent.local.json.
 * Format: { "ideAdapters": ["copilot", "agents", "claude"] }
 * Falls back to all adapters if no preference file or field present.
 */
function loadDirigentPreferences(ADAPTERS) {
  const prefPath = path.join(ROOT, ".aisha", "dirigent.local.json");
  if (existsSync(prefPath)) {
    try {
      const prefs = JSON.parse(readFileSync(prefPath, "utf-8"));
      if (Array.isArray(prefs.ideAdapters) && prefs.ideAdapters.length > 0) {
        const valid = prefs.ideAdapters.filter((id) => ADAPTERS[id]);
        if (valid.length > 0) {
          process.stdout.write(`Using dirigent preferences: ${valid.join(", ")}\n`);
          return valid;
        }
      }
    } catch {
      // malformed JSON — fall through to default
    }
  }
  return Object.keys(ADAPTERS);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = parseFlags(args);

  if (flags.help) {
    printHelp();
    return;
  }

  const { ADAPTERS } = await import("./ide-adapters/registry.mjs");
  const { fetchPayload, loadPayloadFromFile, savePayloadToFile, readStoryId, fetchStackDefaultStoryId } =
    await import("./ide-adapters/payload.mjs");

  if (flags.list) {
    printAdapterList(ADAPTERS);
    return;
  }

  // Determine which adapters to run
  let adapterIds;
  if (flags.format) {
    adapterIds = [flags.format];
  } else {
    // Check for local dirigent preferences
    adapterIds = loadDirigentPreferences(ADAPTERS);
  }

  // Validate adapter IDs
  for (const id of adapterIds) {
    if (!ADAPTERS[id]) {
      process.stderr.write(`Unknown adapter: ${id}\n`);
      process.stderr.write(`Available: ${Object.keys(ADAPTERS).join(", ")}\n`);
      process.exit(1);
    }
  }

  // Resolve story ID (explicit flag > .aisha/story.json > opt-in stack-default lookup)
  let storyId = flags["story-id"] || readStoryId(ROOT);
  if (!storyId && flags["stack-default"]) {
    if (flags.offline) {
      process.stderr.write("--stack-default requires an online lookup and cannot be combined with --offline.\n");
      process.stderr.write("Write .aisha/story.json (or pass --story-id) for offline generation.\n");
      process.exit(1);
    }
    try {
      storyId = await fetchStackDefaultStoryId();
    } catch (error) {
      process.stderr.write(`Stack-default story lookup failed: ${error.message}\n`);
      process.exit(1);
    }
    if (!storyId) {
      process.stderr.write("--stack-default: no stack-default story exists on this instance.\n");
      process.stderr.write("Adopt one first (adopt_story_as_stack_default / ensure_stack_default_story).\n");
      process.exit(1);
    }
    process.stdout.write(`Resolved stack-default story: ${storyId.slice(0, 8)}...\n`);
  }

  // Load payload
  let payload;
  if (flags.offline) {
    payload = loadPayloadFromFile(ROOT);
    if (!payload) {
      process.stderr.write("No cached payload found at .aisha/instruction-payload.json\n");
      process.stderr.write("Run without --offline first to fetch and cache the payload.\n");
      process.exit(1);
    }
    process.stdout.write("Using cached payload.\n");
  } else {
    process.stdout.write(
      `Fetching payload from Supabase` +
        (storyId ? ` (story: ${storyId.slice(0, 8)}...)` : " (default rules)") +
        "\n",
    );
    try {
      payload = await fetchPayload(storyId);
    } catch (error) {
      process.stderr.write(`Failed to fetch payload: ${error.message}\n`);
      process.stderr.write("Trying cached payload as fallback...\n");
      payload = loadPayloadFromFile(ROOT);
      if (!payload) {
        process.stderr.write("No cached payload available. Cannot continue.\n");
        process.exit(1);
      }
      process.stdout.write("Using cached payload (fallback).\n");
    }
  }

  // Optionally save payload
  if (flags["save-payload"]) {
    const cachePath = savePayloadToFile(payload, ROOT);
    process.stdout.write(`Payload cached: ${path.relative(ROOT, cachePath)}\n`);
  }

  // Generate files
  const results = [];

  for (const adapterId of adapterIds) {
    try {
      const adapter = await loadAdapter(adapterId);
      const content = await adapter.generate(payload);

      // Multi-file adapter: iterate files[] and write each (with merge/chmod semantics).
      if (isMultiFileOutput(content)) {
        const fileResults = writeMultiFileOutput(content, adapterId, flags, ROOT);
        results.push(...fileResults);
        continue;
      }

      const outputPath = path.join(ROOT, ADAPTERS[adapterId].outputPath);

      if (flags["dry-run"]) {
        process.stdout.write(`[dry-run] ${ADAPTERS[adapterId].outputPath} (${content.length} chars)\n`);
        results.push({ id: adapterId, path: ADAPTERS[adapterId].outputPath, chars: content.length, ok: true });
        continue;
      }

      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const relPath = ADAPTERS[adapterId].outputPath;
      const outcome = safeWriteSync(
        ROOT,
        relPath,
        content,
        (a, b) => stripVolatile(a) === stripVolatile(b),
      );

      switch (outcome.outcome) {
        case "skipped-identical":
          process.stdout.write(`  = ${relPath} (unchanged)\n`);
          results.push({ id: adapterId, path: relPath, chars: content.length, ok: true, skipped: true });
          break;
        case "refused-user-owned":
          process.stdout.write(`  ! ${relPath} (refused — file is user-owned, no AISHA header)\n`);
          results.push({ id: adapterId, path: relPath, ok: false, error: "refused-user-owned" });
          break;
        case "backup-failed":
          process.stderr.write(`  ✗ ${relPath} (backup failed, write aborted)\n`);
          results.push({ id: adapterId, path: relPath, ok: false, error: "backup-failed" });
          break;
        case "written":
        default: {
          const tag = outcome.preservedUserSection ? " (user-section preserved)" : "";
          const bak = outcome.backupPath ? ` [backup: ${outcome.backupPath}]` : "";
          process.stdout.write(`  ✓ ${relPath} (${content.length} chars)${tag}${bak}\n`);
          results.push({ id: adapterId, path: relPath, chars: content.length, ok: true });
          break;
        }
      }
    } catch (error) {
      process.stderr.write(`  ✗ ${adapterId}: ${error.message}\n`);
      results.push({ id: adapterId, ok: false, error: error.message });
    }
  }

  // Summary
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const written = ok - skipped;
  process.stdout.write(`\nGenerated ${ok}/${results.length} files`);
  if (skipped > 0) {
    process.stdout.write(` (${written} written, ${skipped} unchanged)`);
  }
  if (failed > 0) {
    process.stdout.write(` (${failed} failed)`);
  }
  process.stdout.write(".\n");

  if (failed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--list") {
      flags.list = true;
    } else if (arg === "--all") {
      flags.all = true;
    } else if (arg === "--offline") {
      flags.offline = true;
    } else if (arg === "--save-payload") {
      flags["save-payload"] = true;
    } else if (arg === "--dry-run") {
      flags["dry-run"] = true;
    } else if (arg.startsWith("--format=")) {
      flags.format = arg.slice("--format=".length);
    } else if (arg.startsWith("--story-id=")) {
      flags["story-id"] = arg.slice("--story-id=".length);
    } else if (arg === "--stack-default") {
      flags["stack-default"] = true;
    }
  }
  return flags;
}

function printHelp() {
  // Dynamically load adapter list
  import("./ide-adapters/registry.mjs").then(({ ADAPTERS }) => {
    const ids = Object.keys(ADAPTERS).join(" | ");
    process.stdout.write(`
IDE Instruction Generator — AISHA Platform

Usage:
  node scripts/generate-ide-instructions.mjs [options]

Options:
  --format=<id>       Generate only: ${ids}
  --all               Generate all adapters (default)
  --story-id=<uuid>   Override story ID (default: .aisha/story.json)
  --stack-default      Fall back to the instance stack-default story when no
                       story id is configured (replica twin pattern; online only)
  --offline            Use cached payload (.aisha/instruction-payload.json)
  --save-payload       Cache payload for offline use
  --dry-run            Print outputs without writing
  --list               List available adapters
  --help               Show help

Examples:
  npm run gen:ide                              # All adapters, from local DB
  npm run gen:ide -- --format=copilot          # Only copilot instructions
  npm run gen:ide -- --save-payload            # Fetch + cache payload
  npm run gen:ide -- --offline                 # Generate from cache
`);
  });
}

function printAdapterList(adapters) {
  process.stdout.write("\nAvailable IDE adapters:\n\n");
  for (const [id, info] of Object.entries(adapters)) {
    process.stdout.write(`  ${id.padEnd(15)} → ${info.outputPath.padEnd(40)} ${info.description}\n`);
  }
  process.stdout.write("\n");
}

/**
 * Write a multi-file adapter output to disk. Supports `mode: "executable"`
 * (chmod +x) and `merge: "merge-json-keys"` (deep merge into existing JSON).
 *
 * Returns one result entry per emitted file so the summary line matches what
 * single-file adapters produce.
 *
 * @param {{ files: Array<{ path: string, content: string, mode?: string, merge?: string }> }} output
 * @param {string} adapterId
 * @param {Record<string, any>} flags
 * @param {string} rootDir
 * @returns {Array<{ id: string, path: string, chars?: number, ok: boolean, skipped?: boolean, error?: string }>}
 */
function writeMultiFileOutput(output, adapterId, flags, rootDir) {
  const results = [];

  for (const file of output.files) {
    const relPath = file.path;
    const fullPath = path.join(rootDir, relPath);

    try {
      if (flags["dry-run"]) {
        process.stdout.write(`[dry-run] ${relPath} (${file.content.length} chars)\n`);
        results.push({ id: adapterId, path: relPath, chars: file.content.length, ok: true });
        continue;
      }

      const dir = path.dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // merge: "merge-json-keys" — deep merge into existing JSON (settings.json)
      if (file.merge === "merge-json-keys") {
        const existing = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
        const merged = mergeSettingsJson(existing, file.content);
        if (existing === merged) {
          process.stdout.write(`  = ${relPath} (unchanged, merged)\n`);
          results.push({ id: adapterId, path: relPath, chars: merged.length, ok: true, skipped: true });
        } else {
          writeFileSync(fullPath, merged);
          process.stdout.write(`  ✓ ${relPath} (${merged.length} chars, merged)\n`);
          results.push({ id: adapterId, path: relPath, chars: merged.length, ok: true });
        }
        continue;
      }

      // Executable scripts (shell/python) skip safeWriteSync because the user-section
      // HTML markers it injects are noise in non-markdown files.
      if (file.mode === "executable") {
        const existing = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
        if (existing === file.content) {
          process.stdout.write(`  = ${relPath} (unchanged, executable)\n`);
          results.push({ id: adapterId, path: relPath, chars: file.content.length, ok: true, skipped: true });
          chmodSync(fullPath, 0o755);
          continue;
        }
        writeFileSync(fullPath, file.content);
        chmodSync(fullPath, 0o755);
        process.stdout.write(`  ✓ ${relPath} (${file.content.length} chars, executable)\n`);
        results.push({ id: adapterId, path: relPath, chars: file.content.length, ok: true });
        continue;
      }

      // Default: full overwrite via safeWriteSync (user-section protection still applies)
      const outcome = safeWriteSync(
        rootDir,
        relPath,
        file.content,
        (a, b) => stripVolatile(a) === stripVolatile(b),
      );

      switch (outcome.outcome) {
        case "skipped-identical":
          process.stdout.write(`  = ${relPath} (unchanged)\n`);
          results.push({ id: adapterId, path: relPath, chars: file.content.length, ok: true, skipped: true });
          break;
        case "refused-user-owned":
          process.stdout.write(`  ! ${relPath} (refused — user-owned, no AISHA header)\n`);
          results.push({ id: adapterId, path: relPath, ok: false, error: "refused-user-owned" });
          break;
        case "backup-failed":
          process.stderr.write(`  ✗ ${relPath} (backup failed)\n`);
          results.push({ id: adapterId, path: relPath, ok: false, error: "backup-failed" });
          break;
        case "written":
        default: {
          const tag = outcome.preservedUserSection ? " (user-section preserved)" : "";
          const bak = outcome.backupPath ? ` [backup: ${outcome.backupPath}]` : "";
          process.stdout.write(`  ✓ ${relPath} (${file.content.length} chars)${tag}${bak}\n`);
          results.push({ id: adapterId, path: relPath, chars: file.content.length, ok: true });
        }
      }

      if (file.mode === "executable" && existsSync(fullPath)) {
        chmodSync(fullPath, 0o755);
      }
    } catch (error) {
      process.stderr.write(`  ✗ ${relPath}: ${error.message}\n`);
      results.push({ id: adapterId, path: relPath, ok: false, error: error.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((error) => {
  process.stderr.write(`Fatal: ${error.message}\n`);
  process.exit(1);
});
