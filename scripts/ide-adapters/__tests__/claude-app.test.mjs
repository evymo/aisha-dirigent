/**
 * @module claude-app.test (vitest)
 * Script-side units for the AISHA Dirigent Claude app, runnable under the repo's
 * `test:scripts` harness (vitest.scripts.config.mjs → scripts/**\/*.test.mjs):
 * the gen:ide adapter, the server's declared surface, the composition tools, and
 * the zero-dep zip packer. (The server's stdio protocol is covered by the
 * node:test suite in extensions/aisha-dirigent-claude/__tests__.)
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SERVER = path.join(REPO_ROOT, "extensions", "aisha-dirigent-claude", "server", "index.mjs");

describe("claude-app adapter", () => {
  test("emits a valid MCPB manifest, plugin, and a slash command per tool", async () => {
    const { generate, meta } = await import("../adapter-claude-app.mjs");
    expect(meta.id).toBe("claude-app");
    expect(meta.multiFile).toBe(true);

    const out = await generate({ ruleset: { fingerprint: "fp" }, generated_at: "2026-01-01T00:00:00Z" });
    const byRel = new Map(
      out.files.map((f) => [f.path.replace("extensions/aisha-dirigent-claude/", ""), f.content]),
    );

    const manifest = JSON.parse(byRel.get("manifest.json"));
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("server/index.mjs");
    expect(manifest.tools.length).toBeGreaterThanOrEqual(26);
    expect(manifest.user_config.workspace_root).toBeTruthy();

    for (const t of manifest.tools) {
      const slug = t.name.replace(/^aisha_/, "").replace(/_/g, "-");
      expect(byRel.has(`commands/${slug}.md`), `command for ${t.name}`).toBe(true);
    }

    const plugin = JSON.parse(byRel.get(".claude-plugin/plugin.json"));
    expect(plugin.name).toBe("aisha-dirigent");
    expect(JSON.parse(byRel.get(".mcp.json")).mcpServers["aisha-dirigent"]).toBeTruthy();
    expect(byRel.get("skills/aisha-dirigent/SKILL.md")).toMatch(
      /Auto-generated from AISHA Expert Overlay ruleset\./,
    );
  });
});

describe("server surface", () => {
  test("--list-tools exposes read + composition tools", () => {
    const surface = JSON.parse(execFileSync("node", [SERVER, "--list-tools"], { cwd: REPO_ROOT, encoding: "utf-8" }));
    const names = surface.tools.map((t) => t.name);
    for (const expected of [
      "aisha_seed_status",
      "aisha_merge_status",
      "aisha_cost_usage",
      "aisha_compose_overlay",
      "aisha_scaffold",
      "aisha_overlay_plan",
      "aisha_bringup",
      "aisha_compliance",
      "aisha_estimate",
      "aisha_onboard",
      "aisha_proposals",
      "aisha_spend_approve",
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
    expect(surface.tools.length).toBeGreaterThanOrEqual(26);
  });
});

describe("composition tools", () => {
  test("aisha_scaffold previews without writing when apply is omitted", async () => {
    const { TOOLS } = await import("../../../extensions/aisha-dirigent-claude/server/tools.mjs");
    const scaffold = TOOLS.find((t) => t.name === "aisha_scaffold");
    expect(scaffold).toBeTruthy();

    const name = "vitest-temp-scaffold-xyz";
    const res = await scaffold.handler({ kind: "skill", name, apply: false }, { root: REPO_ROOT });
    expect(res.text).toMatch(/Preview/);
    expect(res.isError).toBeFalsy();
    // Crucially: nothing written.
    expect(existsSync(path.join(REPO_ROOT, ".claude", "skills", name, "SKILL.md"))).toBe(false);
  });

  test("aisha_compose_overlay defaults to dry-run and rejects unknown formats", async () => {
    const { TOOLS } = await import("../../../extensions/aisha-dirigent-claude/server/tools.mjs");
    const compose = TOOLS.find((t) => t.name === "aisha_compose_overlay");
    expect(compose).toBeTruthy();
    const res = await compose.handler({ formats: ["not-a-format"] }, { root: REPO_ROOT });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No valid formats/);
  });

  test("aisha_bringup dryRun reports the command without starting the stack", async () => {
    const { TOOLS } = await import("../../../extensions/aisha-dirigent-claude/server/tools.mjs");
    const bringup = TOOLS.find((t) => t.name === "aisha_bringup");
    expect(bringup).toBeTruthy();
    const res = await bringup.handler({ dryRun: true }, { root: REPO_ROOT });
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/dryRun/);
    expect(res.text).toMatch(/stack:bringup/);
    // It must surface the canonical argv, not spawn anything.
    expect(res.text).toMatch(/"--json"/);
  });
});

describe("mini-zip packer", () => {
  test("produces a valid, inflatable archive", async () => {
    const { collectFiles, writeZip } = await import("../../lib/mini-zip.mjs");
    const dir = mkdtempSync(path.join(os.tmpdir(), "aisha-zip-"));
    writeFileSync(path.join(dir, "a.txt"), "hello aisha");
    const outFile = path.join(dir, "out.mcpb");

    const size = writeZip(outFile, collectFiles(dir, ["a.txt"]));
    expect(size).toBeGreaterThan(0);

    const buf = readFileSync(outFile);
    expect(buf.slice(0, 4).toString("hex")).toBe("504b0304");
    const nlen = buf.readUInt16LE(26);
    const csize = buf.readUInt32LE(18);
    const start = 30 + nlen + buf.readUInt16LE(28);
    expect(inflateRawSync(buf.slice(start, start + csize)).toString()).toBe("hello aisha");
  });
});

describe("parity tools", () => {
  async function tool(name) {
    const { TOOLS } = await import("../../../extensions/aisha-dirigent-claude/server/tools.mjs");
    return TOOLS.find((t) => t.name === name);
  }

  test("aisha_estimate computes per-profile costs locally (no backend)", async () => {
    const res = await (await tool("aisha_estimate")).handler({ tokens: 1_000_000, slot: "default" }, { root: REPO_ROOT });
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/estimates/);
    expect(res.text).toMatch(/usd/);
  });

  test("aisha_onboard reads the enterprise onboarding mandate (local)", async () => {
    const res = await (await tool("aisha_onboard")).handler({}, { root: REPO_ROOT });
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/classification|consent|onboarding/i);
  });

  test("aisha_spend_approve previews without apply (no backend call, requires runId)", async () => {
    const t = await tool("aisha_spend_approve");
    const noId = await t.handler({}, { root: REPO_ROOT });
    expect(noId.isError).toBe(true);
    const preview = await t.handler({ runId: "run-123" }, { root: REPO_ROOT });
    expect(preview.isError).toBeFalsy();
    expect(preview.text).toMatch(/Preview/);
    expect(preview.text).toMatch(/approve_task_spend_audited/);
    expect(preview.text).toMatch(/run-123/);
  });

  test("backend tools fail soft when no backend token is configured", async () => {
    // No AISHA token in the test env → resolveBackend yields no usable creds.
    const prevEnv = { ...process.env };
    for (const k of ["AISHA_TOKEN", "AISHA_SERVICE_KEY", "AISHA_POSTGREST_SERVICE_KEY", "VITE_AISHA_GATEWAY_KEY"]) delete process.env[k];
    try {
      const res = await (await tool("aisha_spend_pending")).handler({}, { root: REPO_ROOT });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/not configured|backend/i);
    } finally {
      process.env = prevEnv;
    }
  });
});
