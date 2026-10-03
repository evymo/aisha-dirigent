#!/usr/bin/env node

/**
 * @module dirigent-collect-local-customizations
 *
 * Scan generated IDE instruction files for user-section blocks and produce a
 * local proposal queue (`.aisha/local-rule-proposals.json`).
 *
 * Design principles:
 *  - **Read-only by default** — never sends anything off-machine.
 *  - **Explicit submit step** — proposals stay in `.aisha/` until the
 *    developer runs `--submit` (or uses the `/aisha-propose-rule` slash
 *    command). Aligns with the AISHA Dirigent advisory-only golden principle.
 *  - **Idempotent** — re-running produces the same queue. A SHA-256 of the
 *    user-section content is used as a stable id; identical content does
 *    not duplicate the entry.
 *
 * Usage:
 *   node scripts/dirigent-collect-local-customizations.mjs           # scan + queue
 *   node scripts/dirigent-collect-local-customizations.mjs --print   # just print
 *   node scripts/dirigent-collect-local-customizations.mjs --submit  # submit via MCP (TODO)
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractUserSection } from "./lib/ide-instructions-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const QUEUE_PATH = path.join(ROOT, ".aisha", "local-rule-proposals.json");

async function loadAdapterRegistry() {
  const mod = await import("./ide-adapters/registry.mjs");
  return mod.ADAPTERS;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) return { version: 1, proposals: [] };
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8"));
  } catch {
    return { version: 1, proposals: [] };
  }
}

function saveQueue(queue) {
  mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
}

function isOnlyTemplatePlaceholder(inner) {
  const stripped = inner.replace(/<!--[\s\S]*?-->/g, "").trim();
  return stripped.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const print = args.includes("--print");
  const submit = args.includes("--submit");

  const ADAPTERS = await loadAdapterRegistry();
  const queue = loadQueue();
  const existingIds = new Set(queue.proposals.map((p) => p.id));

  const found = [];
  for (const [adapterId, info] of Object.entries(ADAPTERS)) {
    const abs = path.join(ROOT, info.outputPath);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, "utf-8");
    const inner = extractUserSection(content);
    if (inner === null || isOnlyTemplatePlaceholder(inner)) continue;

    const id = sha256(`${info.outputPath}::${inner.trim()}`);
    found.push({
      id,
      adapter: adapterId,
      source_path: info.outputPath,
      content: inner.trim(),
      detected_at: new Date().toISOString(),
    });
  }

  if (found.length === 0) {
    process.stdout.write("No local customizations found in any generated IDE file.\n");
    return;
  }

  if (print) {
    process.stdout.write(`Found ${found.length} user-section block(s):\n\n`);
    for (const p of found) {
      process.stdout.write(`── ${p.source_path} (${p.id}) ──\n`);
      process.stdout.write(`${p.content}\n\n`);
    }
    return;
  }

  let added = 0;
  for (const proposal of found) {
    if (existingIds.has(proposal.id)) continue;
    queue.proposals.push(proposal);
    added++;
  }

  saveQueue(queue);
  process.stdout.write(
    `Scanned ${found.length} customization(s); ${added} new queued in ${path.relative(ROOT, QUEUE_PATH)}.\n`,
  );
  process.stdout.write(`Queue size: ${queue.proposals.length}\n`);

  if (submit) {
    process.stderr.write(
      "\n[--submit] Not yet wired. The proposal queue is local-only until the MCP\n" +
        "`mcp_propose_rule_from_local_edit` endpoint ships. Re-run without --submit\n" +
        "to add proposals to the queue, then ship them when the endpoint is available.\n",
    );
    process.exit(2);
  }

  process.stdout.write(
    "\nNext step: review the queue and run `node scripts/dirigent-collect-local-customizations.mjs --submit`\n" +
      "(or use the /aisha-propose-rule slash command in Claude Code) to send them upstream.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
