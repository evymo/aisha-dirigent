import { describe, it, expect } from "vitest";
import { mergeMcpJson } from "./mcp-json-merge.mjs";

describe("mergeMcpJson", () => {
  const managed = { type: "http", url: "https://api.example/mcp" };

  it("preserves a pre-existing user server while upserting the managed one", () => {
    const existing = JSON.stringify(
      {
        mcpServers: {
          "user-custom": { command: "node", args: ["my-server.mjs"] },
        },
      },
      null,
      2,
    );

    const out = mergeMcpJson(existing, "aisha-knowledge", managed);
    const parsed = JSON.parse(out);

    // user entry untouched
    expect(parsed.mcpServers["user-custom"]).toEqual({
      command: "node",
      args: ["my-server.mjs"],
    });
    // managed entry set
    expect(parsed.mcpServers["aisha-knowledge"]).toEqual(managed);
    // pretty + trailing newline
    expect(out.endsWith("\n")).toBe(true);
  });

  it("preserves unrelated top-level keys", () => {
    const existing = JSON.stringify({ $schema: "x", other: { a: 1 } });
    const parsed = JSON.parse(mergeMcpJson(existing, "aisha-knowledge", managed));
    expect(parsed.$schema).toBe("x");
    expect(parsed.other).toEqual({ a: 1 });
    expect(parsed.mcpServers["aisha-knowledge"]).toEqual(managed);
  });

  it("first-write into empty input seeds mcpServers", () => {
    for (const empty of ["", "   ", "\n"]) {
      const parsed = JSON.parse(mergeMcpJson(empty, "aisha-knowledge", managed));
      expect(parsed).toEqual({ mcpServers: { "aisha-knowledge": managed } });
    }
  });

  it("overwrites an existing entry of the same name", () => {
    const existing = JSON.stringify({
      mcpServers: { "aisha-knowledge": { type: "http", url: "https://old" } },
    });
    const parsed = JSON.parse(mergeMcpJson(existing, "aisha-knowledge", managed));
    expect(parsed.mcpServers["aisha-knowledge"]).toEqual(managed);
  });

  it("malformed input does not throw and is treated as {}", () => {
    expect(() => mergeMcpJson("{ not json", "aisha-knowledge", managed)).not.toThrow();
    const parsed = JSON.parse(mergeMcpJson("{ not json", "aisha-knowledge", managed));
    expect(parsed).toEqual({ mcpServers: { "aisha-knowledge": managed } });
  });

  it("non-object JSON (array) is treated as {}", () => {
    const parsed = JSON.parse(mergeMcpJson("[1,2,3]", "aisha-knowledge", managed));
    expect(parsed).toEqual({ mcpServers: { "aisha-knowledge": managed } });
  });
});
