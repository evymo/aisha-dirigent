#!/usr/bin/env node
/**
 * @module hook-session-context
 * Claude Code SessionStart hook — injects a compact AISHA Dirigent context block
 * (active story, domain, rule source, branch) so the agent starts each session
 * aware of the project's governance state. Mirrors the advisory intent of the
 * VS Code extension's status bar.
 *
 * Output: plain text on stdout (Claude Code adds SessionStart stdout to context).
 * Never fails the session — any error exits 0 with no output.
 */

import { readText, readJson, resolveWorkspace, run } from "./lib.mjs";

try {
  const root = resolveWorkspace();
  const session = readJson(root, ".aisha/session.json") || {};
  const rules = readJson(root, ".aisha/active-rules.json") || {};
  const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 4000 }))
    .stdout.trim();

  const categories = Object.keys(rules.rules || {});
  const lines = [
    "AISHA Dirigent — active governance context:",
    `• story: ${session.storyId || "(none)"} · domain: ${session.domain || rules.direction?.domain || "general"}`,
    `• rules: ${categories.length} categories (${categories.join(", ") || "none"}) · source: ${rules.source || "?"}`,
    branch ? `• git branch: ${branch}` : null,
    "• Dirigent tools available via the aisha-dirigent MCP server (seed/merge status, route, models, health, cost/usage, sync). Use /aisha-dirigent:* commands.",
    readText(root, "CLAUDE.md") ? "• Project CLAUDE.md is present — follow it." : null,
  ].filter(Boolean);

  process.stdout.write(lines.join("\n") + "\n");
} catch {
  /* never block a session */
}
process.exit(0);
