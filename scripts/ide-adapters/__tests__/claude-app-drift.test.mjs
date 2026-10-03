/**
 * @module claude-app-drift.test (vitest)
 * Drift gate: the AISHA Dirigent MCP server is bundled standalone into the .mcpb
 * (it ships only `server/`), so it cannot import the repo's shared modules at
 * runtime and instead DUPLICATES two contracts:
 *
 *   1. the local-stack bring-up entry-point + status parsing
 *      SoT: scripts/lib/bringup-contract.mjs
 *      copy: extensions/aisha-dirigent-claude/server/tools.mjs
 *   2. the .claude/settings.json deep-merge semantics
 *      SoT: scripts/ide-adapters/multi-file.mjs::mergeSettingsJson
 *      copy: extensions/aisha-dirigent-claude/server/lib.mjs::mergeSettingsJson
 *
 * This gate fails loudly if a copy drifts from its source of truth, so the two
 * never silently diverge. Runs under the repo's `test:scripts` harness.
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as contract from "../../lib/bringup-contract.mjs";
import * as server from "../../../extensions/aisha-dirigent-claude/server/tools.mjs";
import { mergeSettingsJson as sotMerge } from "../multi-file.mjs";
import { mergeSettingsJson as libMerge } from "../../../extensions/aisha-dirigent-claude/server/lib.mjs";

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "extensions", "aisha-dirigent-claude");
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");
const slug = (name) => name.replace(/^aisha_/, "").replace(/_/g, "-");

describe("bring-up contract: server inline copy === SoT", () => {
  test("STACK_BRINGUP_ARGS and STACK_BRINGUP_CMD match the contract", () => {
    expect(server.STACK_BRINGUP_ARGS).toEqual(contract.STACK_BRINGUP_ARGS);
    expect(server.STACK_BRINGUP_CMD).toBe(contract.STACK_BRINGUP_CMD);
    // The argv form must reconstruct the canonical `npm run stack:bringup -- --json`.
    expect(`npm ${server.STACK_BRINGUP_ARGS.join(" ")}`).toBe(contract.STACK_BRINGUP_CMD_JSON);
  });

  test("parseBringupResult parses identically to the contract", () => {
    const samples = [
      'warming up\n{"healthy":true,"gatewayUrl":"http://localhost:3001","services":[]}\ndone',
      "no json status line here at all",
      '{"step":1}\n{"healthy":false,"gatewayUrl":null,"services":[{"name":"db","status":"down"}]}',
      "{ not valid json }",
      "",
    ];
    for (const s of samples) {
      expect(server.parseBringupResult(s)).toEqual(contract.parseBringupResult(s));
    }
  });
});

describe("settings merge: server lib copy === SoT (multi-file)", () => {
  // [existingJson, generatedPatchJson] — valid inputs where both must agree exactly.
  const cases = [
    // fresh file gets an AISHA-managed hook
    ["", '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x","_aisha":{"managed":true}}]}]}}'],
    // user hook on same matcher is preserved; managed one is (re)added
    [
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"user-keep"}]}]}}',
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"aisha","_aisha":{"managed":true}}]}]}}',
    ],
    // permissions arrays union + de-dupe
    ['{"permissions":{"allow":["A"]}}', '{"permissions":{"allow":["A","B"],"deny":["C"]}}'],
    // statusLine replaced only when generated declares ownership
    ['{"statusLine":{"user":1}}', '{"statusLine":{"_aisha":{"managed":true},"gen":2}}'],
    // unrelated user keys survive untouched
    ['{"env":{"FOO":"bar"},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"keep"}]}]}}', '{"_aisha_managed":{"v":1}}'],
  ];

  test("identical output on valid inputs", () => {
    for (const [existing, generated] of cases) {
      expect(libMerge(existing, generated)).toBe(sotMerge(existing, generated));
    }
  });

  test("both fail loud on malformed existing JSON (never clobber)", () => {
    expect(() => libMerge("{ broken", "{}")).toThrow();
    expect(() => sotMerge("{ broken", "{}")).toThrow();
  });
});

describe("generation drift: committed package === server surface", () => {
  // The packaging layer (manifest.json, commands/) is generated from the server's
  // --list-tools. If someone adds/renames a tool but forgets to regenerate
  // (`npm run package:claude-app`), the committed package silently drifts. This
  // gate fails until it is regenerated.
  const surface = JSON.parse(
    execFileSync("node", [path.join(APP_DIR, "server", "index.mjs"), "--list-tools"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  );
  const serverNames = surface.tools.map((t) => t.name).sort();

  test("manifest.json tool set equals the live server surface", () => {
    const manifest = JSON.parse(readFileSync(path.join(APP_DIR, "manifest.json"), "utf-8"));
    const manifestNames = manifest.tools.map((t) => t.name).sort();
    expect(manifestNames).toEqual(serverNames);
  });

  test("every server tool has a committed slash command", () => {
    for (const name of serverNames) {
      const cmd = path.join(APP_DIR, "commands", `${slug(name)}.md`);
      expect(existsSync(cmd), `missing committed command for ${name}: commands/${slug(name)}.md`).toBe(true);
    }
  });

  test("manifest is deterministic (no wall-clock timestamp to churn diffs)", () => {
    const raw = readFileSync(path.join(APP_DIR, "manifest.json"), "utf-8");
    expect(raw).not.toMatch(/generated_at/);
  });

  test("plugin.json + .mcp.json are present and wired to the server", () => {
    const plugin = JSON.parse(readFileSync(path.join(APP_DIR, ".claude-plugin", "plugin.json"), "utf-8"));
    expect(plugin.name).toBe("aisha-dirigent");
    const mcp = JSON.parse(readFileSync(path.join(APP_DIR, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers["aisha-dirigent"].args.join(" ")).toMatch(/server\/index\.mjs/);
  });
});
