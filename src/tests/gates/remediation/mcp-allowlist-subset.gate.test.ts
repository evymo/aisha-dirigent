/**
 * Gate (remediation KB-01-mcp-allowlist): the gateway's intranet MCP tool
 * allowlist must be a SUBSET of the live MCP tool surface actually implemented
 * by svc-mcp-knowledge.
 *
 * Why this exists: services/gateway/src/routes/intranet.ts proxies intranet
 * (Appsmith) users to the MCP knowledge server, gating tool invocation on
 * MCP_TOOL_ALLOWLIST. That allowlist is a hand-maintained Set of tool names.
 * The real tool surface is TOOL_DEFINITIONS in
 * services/svc-mcp-knowledge/src/routes/mcp.ts, registered via `tool('name', ...)`.
 *
 * If a name is allowlisted but NOT implemented, the gateway advertises /
 * permits a tool that the MCP server will reject with "Unknown MCP tool" at
 * call time — a dangling contract: the allowlist promises capabilities the
 * backend does not have. Every allowlisted name MUST resolve to a real tool.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd): 7
 * allowlisted names are absent from TOOL_DEFINITIONS:
 *     get_project_context
 *     get_knowledge_topics_localized
 *     get_public_chat_channel_config
 *     list_public_chat_channels
 *     get_design_profile
 *     get_model_registry
 *     search_ragnarok
 *
 * After the fix (either implement those tools in mcp.ts, or remove the dangling
 * names from the gateway allowlist) this gate goes green. Do NOT weaken the
 * assertion — reconcile the two lists at their source.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const INTRANET = "services/gateway/src/routes/intranet.ts";
const MCP = "services/svc-mcp-knowledge/src/routes/mcp.ts";

/** Strip `//` and block comments so commented-out names don't count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Parse MCP_TOOL_ALLOWLIST = new Set([ ...string literals... ]) from
 * intranet.ts. Returns the exact set of allowlisted tool names.
 */
function parseAllowlist(src: string): string[] {
  const m = src.match(/MCP_TOOL_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("Could not locate MCP_TOOL_ALLOWLIST in intranet.ts");
  return [...m[1].matchAll(/['"]([A-Za-z0-9_]+)['"]/g)].map((x) => x[1]);
}

/**
 * Parse the implemented tool surface: every `tool('name', ...)` registration
 * inside the TOOL_DEFINITIONS array literal in mcp.ts.
 */
function parseToolDefinitions(src: string): Set<string> {
  const block = src.match(/TOOL_DEFINITIONS\s*:\s*ToolDefinition\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error("Could not locate TOOL_DEFINITIONS in mcp.ts");
  const names = [...block[1].matchAll(/\btool\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((x) => x[1]);
  return new Set(names);
}

describe("gateway MCP allowlist ⊆ implemented tool surface", () => {
  test("every allowlisted MCP tool is implemented in TOOL_DEFINITIONS", () => {
    const allowlistSrc = stripComments(readFileSync(join(ROOT, INTRANET), "utf-8"));
    const mcpSrc = stripComments(readFileSync(join(ROOT, MCP), "utf-8"));

    const allowlist = parseAllowlist(allowlistSrc);
    const implemented = parseToolDefinitions(mcpSrc);

    // Sanity: both parsers found real content (guards against a refactor that
    // silently makes this gate a no-op).
    expect(allowlist.length).toBeGreaterThan(0);
    expect(implemented.size).toBeGreaterThan(0);

    const dangling = allowlist.filter((name) => !implemented.has(name));

    expect(
      dangling,
      `Allowlisted MCP tools with NO implementation in ${MCP} ` +
        `(implement the tool, or drop it from MCP_TOOL_ALLOWLIST in ${INTRANET}): ` +
        dangling.join(", "),
    ).toEqual([]);
  });
});
