/**
 * impl 01 (odysseus) — dynamic tool selection v1: wire the route-plan allowlist.
 *
 * AISHA's `route_task` RPC already computes RoutePlan.toolsAllowlist for every
 * chat interaction (see orchestrationBridge.routeViaAisha). This module applies
 * it to the channel tool catalog so the LLM receives only the tools relevant to
 * the routed task instead of the full channelConfig.allowed_tools set
 * (context-bloat reduction; see docs/analysis/odysseus-inspiration/impl/01).
 *
 * Security invariant (enforced by construction + tool-select gate):
 *   result ⊆ channelToolNames — the allowlist can only NARROW channel rights,
 *   never extend them. Post-selection per-tool gating (canUseTool /
 *   accessTierMin / requiresConsent) stays untouched downstream.
 *
 * Parity fallbacks (impl/12 §B-5):
 *   - feature flag off → channel set unchanged (today's behavior)
 *   - empty / absent allowlist → channel set unchanged (no narrowing signal;
 *     orchestrationBridge maps a missing RPC field to [])
 *   - disjoint allowlist → fail-open to the channel set: a route/channel
 *     mismatch must degrade to today's behavior, not zero the agent's tools
 *
 * NOTE: this hook lives in chat.ts (allowed_tools consumer) by design — NOT in
 * svc-mcp-knowledge routes/mcp.ts tools/list, which must keep returning the
 * full catalog for MCP protocol discovery (impl/09 §B-1).
 */

export interface ToolsAllowlistOptions {
  /** Feature flag `DYNAMIC_TOOL_SELECTION === 'true'` (default off). */
  enabled: boolean;
}

/**
 * Narrow the channel tool set by the route-plan allowlist.
 * Pure function; order of `channelToolNames` is preserved.
 */
export function applyRouteToolsAllowlist(
  channelToolNames: string[],
  toolsAllowlist: string[] | null | undefined,
  opts: ToolsAllowlistOptions,
): string[] {
  if (!opts.enabled) return channelToolNames;
  if (!toolsAllowlist || toolsAllowlist.length === 0) return channelToolNames;

  const allow = new Set(toolsAllowlist);
  const narrowed = channelToolNames.filter((name) => allow.has(name));

  // Fail-open on a disjoint allowlist: an allowlist that matches nothing in
  // the channel catalog is a routing/config mismatch — degrade to parity
  // rather than stripping the agent of all tools.
  if (narrowed.length === 0) return channelToolNames;
  return narrowed;
}

/**
 * Feature flag reader — default OFF, explicit opt-in with 'true'
 * (impl/07 flag matrix: dynamic_tool_selection starts disabled).
 */
export function isDynamicToolSelectionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DYNAMIC_TOOL_SELECTION === "true";
}
