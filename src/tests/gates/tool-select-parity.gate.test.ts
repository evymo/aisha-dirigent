/**
 * Gate: route-plan tool narrowing is wired at the right boundary and can only
 * narrow — never expand — channel tool rights (impl 01, impl/12 §B-5).
 *
 * Guards three contracts:
 *  1. chat.ts consumes RoutePlan.toolsAllowlist via applyRouteToolsAllowlist
 *     BEFORE loadToolsByNames — the allowlist AISHA already computes must not
 *     silently regress back to the full-catalog behavior.
 *  2. svc-mcp-knowledge routes/mcp.ts (MCP protocol tools/list) stays
 *     allowlist-free: MCP discovery must keep returning the full catalog
 *     (impl/09 §B-1 — narrowing there would break MCP clients).
 *  3. toolSelection.ts cannot union the allowlist into the result — the
 *     result set is built exclusively by filtering channelToolNames (static
 *     complement of the unit-test subset invariant).
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const CHAT_TS = "services/svc-ai-chat/src/routes/chat.ts";
const TOOL_SELECTION_TS = "services/svc-ai-chat/src/lib/toolSelection.ts";
const MCP_TS = "services/svc-mcp-knowledge/src/routes/mcp.ts";

describe("tool-select — wiring + subset parity (impl 01)", () => {
  test("chat.ts narrows channel tools via applyRouteToolsAllowlist before loadToolsByNames", () => {
    const src = read(CHAT_TS);
    expect(src, "chat.ts must import the tool-selection helper").toMatch(
      /import\s*\{[^}]*applyRouteToolsAllowlist[^}]*\}\s*from\s*["']\.\.\/lib\/toolSelection\.js["']/,
    );
    const applyIdx = src.indexOf("applyRouteToolsAllowlist(");
    const loadIdx = src.indexOf("loadToolsByNames(");
    expect(applyIdx, "applyRouteToolsAllowlist call site missing").toBeGreaterThan(-1);
    expect(loadIdx, "loadToolsByNames call site missing").toBeGreaterThan(-1);
    expect(applyIdx, "narrowing must happen BEFORE tools are loaded").toBeLessThan(loadIdx);
    expect(src, "route plan allowlist must feed the narrowing").toMatch(
      /applyRouteToolsAllowlist\(\s*channelToolNames,\s*aishaRoutePlan\?\.toolsAllowlist/,
    );
    expect(src, "loadToolsByNames must consume the narrowed set").toMatch(
      /loadToolsByNames\(effectiveToolNames\)/,
    );
  });

  /**
   * Zúžení podle OPRÁVNĚNÍ volajícího (role, allowlist `mcp_` PAT) není výběr
   * nástrojů pro konverzaci — patří do jednoho predikátu, který používá seznam
   * i volání. Dohodnuto s relací aplatform-93 (2026-09-14): brána tvrdí, že
   * tools/list = TOOL_DEFINITIONS.filter(canUseTool) a tools/call jde přes
   * týž canUseTool — nic dalšího seznam nezužuje a nic dalšího volání nepouští.
   */
  test("MCP tools/list i tools/call zužuje JEDEN predikát oprávnění (canUseTool)", () => {
    const src = read(MCP_TS);
    expect(src, "allowedToolDefinitions musí být jen filtr přes canUseTool").toMatch(
      /function allowedToolDefinitions\([^)]*\)[^{]*\{\s*return TOOL_DEFINITIONS\.filter\(\(definition\) => canUseTool\(user, definition\.name\)\);\s*\}/,
    );
    expect(src, "verifyMcpAccess musí odmítnout nástroj přes canUseTool").toMatch(
      /async function verifyMcpAccess[\s\S]{0,300}if \(toolName && !canUseTool\(user, toolName\)\)/,
    );
    expect(src, "tools/list musí vracet allowedToolDefinitions").toMatch(/tools: allowedToolDefinitions\(auth\.user\)/);
    expect((src.match(/canUseTool\(/g) ?? []).length, "canUseTool: 1 definice + 2 použití — třetí cesta by byla druhá autorizace").toBe(3);
  });

  test("MCP protocol discovery (svc-mcp-knowledge mcp.ts) stays allowlist-free", () => {
    const src = read(MCP_TS);
    expect(
      /toolsAllowlist|applyRouteToolsAllowlist/.test(src),
      "mcp.ts tools/list must keep returning the full catalog — narrowing belongs to chat.ts only (impl/09 §B-1)",
    ).toBe(false);
  });

  test("toolSelection.ts builds results only by filtering channelToolNames (never unions the allowlist in)", () => {
    const src = read(TOOL_SELECTION_TS);
    expect(src).toMatch(/channelToolNames\.filter\(/);
    expect(
      /\[\s*\.\.\.\s*toolsAllowlist|channelToolNames\.concat\(|toolsAllowlist\.concat\(|push\(\s*\.\.\.?\s*toolsAllowlist/.test(src),
      "allowlist entries must never be added to the result — subset invariant",
    ).toBe(false);
  });

  test("feature flag is default-off opt-in (=== 'true'), per impl/07 flag matrix", () => {
    const src = read(TOOL_SELECTION_TS);
    expect(src).toMatch(/DYNAMIC_TOOL_SELECTION\s*===\s*["']true["']/);
  });
});
