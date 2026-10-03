#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { mergeMcpJson } from "../lib/mcp-json-merge.mjs";
import { ROOT, resolveDirigentConfig } from "./config.mjs";

const args = new Set(process.argv.slice(2));
const config = resolveDirigentConfig();

// Write the local config to the SAME path the generators read
// (generate-ide-instructions.mjs:58 + config.mjs LOCAL_CONFIG_PATHS prefer
// .aisha/dirigent.local.json). Writing to .evymo/ here was a path drift that
// left the generators reading a stale/empty file.
const localConfigPath = path.join(ROOT, ".aisha", "dirigent.local.json");

mkdirSync(path.dirname(localConfigPath), { recursive: true });

// Read-merge: only the keys this bootstrap owns are (re)set. Any unmanaged keys
// the user (or another generator) added — activeProfile, profiles, ideAdapters,
// etc. — are preserved instead of being clobbered by a fixed key set.
let existingLocal = {};
if (existsSync(localConfigPath)) {
  try {
    const raw = readFileSync(localConfigPath, "utf-8");
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existingLocal = parsed;
    }
  } catch (err) {
    // Never discard the file on a parse error — treat as empty and re-seed
    // the managed keys, leaving nothing to preserve. Warn so a corrupted
    // dirigent.local.json (and the loss of any unmanaged keys) is observable.
    console.warn(
      `[bootstrap-config] ${path.relative(ROOT, localConfigPath)} did not parse as JSON (${err.message}); ` +
        "treating as empty and re-seeding managed keys — unmanaged keys could not be preserved.",
    );
    existingLocal = {};
  }
}

const managedLocal = {
  supabaseUrl: config.supabaseUrl,
  mcpUrl: config.mcpUrl,
  n8nTriggerUrl: config.n8nTriggerUrl,
  anonKey: config.anonKey,
  storyId: config.storyId,
  expertiseLevel: config.expertiseLevel,
  contextProfile: config.contextProfile,
  autonomyMode: config.autonomyMode,
  riskLevel: config.riskLevel,
  deployCommand: config.deployCommand,
  postDeployVerifyCommand: config.postDeployVerifyCommand,
};

const localConfig = { ...existingLocal, ...managedLocal };

writeFileSync(localConfigPath, JSON.stringify(localConfig, null, 2) + "\n");
process.stdout.write(`Wrote ${path.relative(ROOT, localConfigPath)}\n`);

if (args.has("--write-mcp") && config.mcpUrl) {
  const localMcpPath = path.join(ROOT, ".mcp.json");
  const existingMcp = existsSync(localMcpPath) ? readFileSync(localMcpPath, "utf-8") : "";

  // mergeMcpJson upserts ONLY the aisha-knowledge entry and preserves every
  // other mcpServers entry (and unrelated top-level keys) the user added.
  const merged = mergeMcpJson(existingMcp, "aisha-knowledge", {
    type: "http",
    url: config.mcpUrl,
  });

  writeFileSync(localMcpPath, merged);
  process.stdout.write(`Wrote ${path.relative(ROOT, localMcpPath)}\n`);
}
