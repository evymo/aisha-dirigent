/**
 * Tests for the shared safe-patch primitives added beside the IDE-instruction
 * generators:
 *   - mergeMcpJson (multi-file.ts) — upsert one MCP server, preserve the rest.
 *   - safeWriteExecutable (file-safety.ts) — backup-on-change, skip-identical.
 *
 * These mirror the CLI twins
 *   scripts/lib/mcp-json-merge.mjs
 *   scripts/lib/ide-instructions-safety.mjs::safeWriteExecutableSync
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mergeMcpJson } from "../src/generators/multi-file";
import { safeWriteExecutable } from "../src/generators/file-safety";

// ── mergeMcpJson ──────────────────────────────────────────────────

describe("mergeMcpJson", () => {
  const managed = { type: "http", url: "https://api.example/mcp" };

  it("preserves a pre-existing user server while upserting the managed one", () => {
    const existing = JSON.stringify({
      mcpServers: { "user-custom": { command: "node", args: ["x.mjs"] } },
    });
    const parsed = JSON.parse(mergeMcpJson(existing, "aisha-knowledge", managed));
    expect(parsed.mcpServers["user-custom"]).toEqual({ command: "node", args: ["x.mjs"] });
    expect(parsed.mcpServers["aisha-knowledge"]).toEqual(managed);
  });

  it("preserves unrelated top-level keys", () => {
    const existing = JSON.stringify({ $schema: "x", other: { a: 1 } });
    const parsed = JSON.parse(mergeMcpJson(existing, "aisha-knowledge", managed));
    expect(parsed.$schema).toBe("x");
    expect(parsed.other).toEqual({ a: 1 });
  });

  it("first-write into empty input seeds mcpServers and ends with newline", () => {
    const out = mergeMcpJson("", "aisha-knowledge", managed);
    expect(out.endsWith("\n")).toBe(true);
    expect(JSON.parse(out)).toEqual({ mcpServers: { "aisha-knowledge": managed } });
  });

  it("malformed input does not throw and is treated as {}", () => {
    expect(() => mergeMcpJson("{ broken", "aisha-knowledge", managed)).not.toThrow();
    expect(JSON.parse(mergeMcpJson("{ broken", "aisha-knowledge", managed))).toEqual({
      mcpServers: { "aisha-knowledge": managed },
    });
  });
});

// ── safeWriteExecutable ───────────────────────────────────────────

describe("safeWriteExecutable", () => {
  // In-memory fs backed by the vscode mock. Keys are fsPath strings.
  let store: Map<string, string>;

  beforeEach(async () => {
    store = new Map<string, string>();
    const vscode = await import("vscode");
    (vscode.workspace.fs as Record<string, unknown>).readFile = async (uri: { fsPath: string }) => {
      if (!store.has(uri.fsPath)) throw new Error("ENOENT");
      return new TextEncoder().encode(store.get(uri.fsPath)!);
    };
    (vscode.workspace.fs as Record<string, unknown>).writeFile = async (
      uri: { fsPath: string },
      content: Uint8Array,
    ) => {
      store.set(uri.fsPath, new TextDecoder().decode(content));
    };
    (vscode.workspace.fs as Record<string, unknown>).createDirectory = async () => {};
    (vscode.workspace.fs as Record<string, unknown>).readDirectory = async () => {
      const root = "/repo/.aisha/backups";
      const out: [string, number][] = [];
      for (const key of store.keys()) {
        if (key.startsWith(root + "/")) out.push([key.slice(root.length + 1), 1]);
      }
      return out;
    };
    (vscode.workspace.fs as Record<string, unknown>).delete = async (uri: { fsPath: string }) => {
      store.delete(uri.fsPath);
    };
  });

  const rootUri = { fsPath: "/repo" } as import("vscode").Uri;
  const rel = ".claude/hooks/aisha-advise.sh";

  it("writes a new executable file (no backup) without user-section markers", async () => {
    const content = "#!/usr/bin/env bash\necho hi\n";
    const res = await safeWriteExecutable(rootUri, rel, content);
    expect(res.outcome).toBe("written");
    expect(res.backupPath).toBeUndefined();
    expect(store.get("/repo/" + rel)).toBe(content);
    expect(store.get("/repo/" + rel)).not.toContain("aisha:user-section");
  });

  it("writes a timestamped backup when content changes", async () => {
    store.set("/repo/" + rel, "#!/bin/sh\necho old\n");
    const res = await safeWriteExecutable(rootUri, rel, "#!/bin/sh\necho new\n");
    expect(res.outcome).toBe("written");
    expect(res.backupPath).toBeTruthy();
    expect(store.get("/repo/" + rel)).toBe("#!/bin/sh\necho new\n");

    const backups = [...store.keys()].filter(
      (k) => k.startsWith("/repo/.aisha/backups/") && k.endsWith(".bak"),
    );
    expect(backups.length).toBe(1);
    expect(store.get(backups[0])).toBe("#!/bin/sh\necho old\n");
  });

  it("skips when the new content is byte-identical", async () => {
    const content = "#!/bin/sh\necho same\n";
    store.set("/repo/" + rel, content);
    const res = await safeWriteExecutable(rootUri, rel, content);
    expect(res.outcome).toBe("skipped-identical");
    // no backup taken on a skip
    const backups = [...store.keys()].filter((k) => k.startsWith("/repo/.aisha/backups/"));
    expect(backups.length).toBe(0);
  });
});
