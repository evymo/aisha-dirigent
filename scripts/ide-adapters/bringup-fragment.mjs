#!/usr/bin/env node

/**
 * @module bringup-fragment
 * Shared "Local backend health & bring-up" markdown fragment injected into the
 * IDE adapter outputs (AGENTS.md, codex SKILL.md, CLAUDE.md).
 *
 * Every IDE/agent integration must point the user at the SAME shared
 * entry-point — `npm run stack:bringup` — when no AISHA backend is reachable.
 * The wording (BRINGUP_HINT) + command live in ONE source of truth
 * (scripts/lib/bringup-contract.mjs); this fragment is just the markdown shell
 * around it, shared across adapters so they never drift.
 *
 * Unconditional by design: unlike the router fragment (gateway-gated), the
 * bring-up hint IS the remediation for "no backend reachable", so it must
 * always be present.
 */

import {
  BRINGUP_HINT,
  STACK_BRINGUP_CMD,
  resolveLocalGatewayHealthUrl,
} from "../lib/bringup-contract.mjs";

/**
 * Render the bring-up fragment for an IDE adapter.
 *
 * @param {object} [opts]
 * @param {"markdown_h2"|"markdown_h3"} [opts.headerStyle="markdown_h2"]
 *   Header level. Most adapters use h2; codex-skill nests under h3.
 * @returns {Promise<string>} Markdown fragment (always non-empty).
 */
export async function bringupFragment(opts = {}) {
  const headerStyle = opts.headerStyle ?? "markdown_h2";
  const title = headerStyle === "markdown_h3" ? "### Local backend & bring-up" : "## Local backend & bring-up";
  const healthUrl = await resolveLocalGatewayHealthUrl();

  return [
    title,
    "",
    BRINGUP_HINT,
    "",
    `Health target: \`${healthUrl}\`. The bring-up is non-interactive and health-gated; its final stdout line is a JSON status object (\`{ healthy, gatewayUrl, services }\`).`,
    "",
    "```bash",
    STACK_BRINGUP_CMD,
    "```",
    "",
    "Every IDE/agent integration uses this same entry-point (the VS Code / Zed Dirigent setup panel, the `aisha_bringup` MCP tool for Claude Code & Zed, and these generated instructions). Do not invoke `local-warmup` directly.",
    "",
  ].join("\n");
}
