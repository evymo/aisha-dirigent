#!/usr/bin/env node

/**
 * @module router-fragment
 * Shared "Router Configuration" markdown fragment injected into every IDE
 * adapter output. Documents the LLM Gateway IDE proxy + Soulforge slot
 * profiles + Dirigent router-coach advisory for the dev IDE in question.
 *
 * Auto-detects gateway availability from the MCP payload: when
 * payload.env?.AISHA_LLM_GATEWAY_URL is absent, returns "" (fragment skipped
 * entirely) so adapters degrade gracefully in setups without the Gateway
 * stack.
 *
 * Lives independently of any single IDE adapter so all 8 adapters share one
 * source-of-truth wording.
 */

/**
 * Render the Router Configuration fragment for an IDE adapter.
 *
 * @param {object} payload — adapter payload (see scripts/ide-adapters/payload.mjs)
 * @param {object} [opts]
 * @param {"markdown_h2"|"markdown_h3"|"plain"} [opts.headerStyle="markdown_h2"]
 *   Header style. Most adapters use h2; codex-skill uses h3 to nest under "Skill".
 * @param {boolean} [opts.includeBatch=true]  Include batch-API guidance section.
 * @param {boolean} [opts.includeIdeEnv=true]  Include ANTHROPIC_BASE_URL / OPENAI_BASE_URL block.
 * @returns {string} Markdown fragment. Returns "" when gateway URL not configured.
 */
export function routerConfigurationFragment(payload, opts = {}) {
  const env = payload?.env ?? {};
  const gatewayUrl = env.AISHA_LLM_GATEWAY_URL ?? env.LLM_GATEWAY_PUBLIC_URL ?? null;
  if (!gatewayUrl) {
    return "";
  }

  const headerStyle = opts.headerStyle ?? "markdown_h2";
  const includeBatch = opts.includeBatch ?? true;
  const includeIdeEnv = opts.includeIdeEnv ?? true;

  const h = (level, text) => `${"#".repeat(level)} ${text}`;
  const titlePrefix = headerStyle === "markdown_h3" ? h(3, "Router Configuration") : h(2, "Router Configuration");
  const subPrefix = headerStyle === "markdown_h3" ? "####" : "###";

  const lines = [
    titlePrefix,
    "",
    "AISHA's LLM routing has 5 orthogonal layers (any may be off):",
    "",
    "1. **Tier system** — model-by-complexity (`MODEL_TIER_*`).",
    "2. **Soulforge slot** — orthogonal `spark|ember|verify|compact|semantic|webSearch|desloppify|default` axis stored in `ai_model_registry.slot_affinity`.",
    "3. **Profile** — `budget | balanced | maxQuality` (in `.aisha/dirigent.json` → `routerCoach.slotProfile`).",
    "4. **Batch routing** — sync vs deferred (50% off) decided by `aisha_choose_execution_strategy`.",
    "5. **Per-clow dispatch** — for each OpenClaw sub-agent (clow), AISHA picks {provider, model, backend_kind, strategy} via `aisha_resolve_clow_backend` from `ai_provider_registry` × `ai_model_registry` × `ai_model_benchmarks`. Backends include `direct_cloud` (Anthropic / OpenAI / Google / HuggingFace), `llm_gateway`, `local_ollama`, `local_vllm`, and `mcp_server`.",
    "",
    `${subPrefix} What this means for IDE use`,
    "",
    "Native IDE plugins/skills keep working unchanged — the LLM Gateway is a transparent OpenAI/Anthropic-compatible proxy. Optionally set the base URL so dev usage is traced into Langfuse (no parallel dashboard).",
    "",
  ];

  if (includeIdeEnv) {
    lines.push(
      `${subPrefix} IDE base URL (opt-in, IDE-side only)`,
      "",
      "```bash",
      `export ANTHROPIC_BASE_URL=${gatewayUrl.replace(/\/$/, "")}/v1`,
      `export OPENAI_BASE_URL=${gatewayUrl.replace(/\/$/, "")}/v1`,
      "# AISHA_LLM_GATEWAY_KEY is set per-developer in .env.local (never committed)",
      "export ANTHROPIC_API_KEY=$AISHA_LLM_GATEWAY_KEY",
      "export OPENAI_API_KEY=$AISHA_LLM_GATEWAY_KEY",
      "```",
      "",
      "Backend (`svc-ai-chat`) keeps calling providers directly — the Gateway is **never** in the autonomous-AISHA path. Same source-of-truth invariants (decisionProvenance + audit_journal) still apply.",
      "",
    );
  }

  if (includeBatch) {
    lines.push(
      `${subPrefix} Deferred / batch routing`,
      "",
      "AISHA dynamically routes deferrable workloads (audit reports, eval runs, summaries with `deadline_hours ≥ 24` and `expected_tokens ≥ 50000`) to Anthropic Message Batches or OpenAI Batch APIs (50% off). Critical tasks remain sync. Decision lives in `aisha_choose_execution_strategy(p_task, p_context)` — never a static pattern.",
      "",
    );
  }

  lines.push(
    `${subPrefix} Router-coach advisory (dev sessions)`,
    "",
    "A PostToolUse hook (consolidated into `.claude/hooks/migration-sot-pair-check.sh`) appends every tool use to `.aisha/session-cost.jsonl` and emits `[router-coach]` stderr advisories when the rolling cost crosses the threshold (`.aisha/dirigent.json` → `routerCoach.costThresholdUsd`, default $0.50). To switch profile mid-session run `/aisha-router-config`.",
    "",
    `${subPrefix} MCP discovery + testing`,
    "",
    "AISHA can register new MCP servers (`aisha_register_mcp_server` RPC), probe them (`aisha_test_mcp_server` + reflection `mcp_test` node), and rely on them only after `tested_ok`. After 3 consecutive failures a server auto-rejects. MCP servers that expose LLM endpoints get paired into `ai_provider_registry` (`backend_kind='mcp_server'`).",
    "",
    `${subPrefix} Deeper analysis`,
    "",
    "- Skill: `.claude/skills/aisha-router-tuning/SKILL.md`",
    "- Slash command: `/aisha-router-config`",
    "- DB-side: `SELECT * FROM get_slot_routing_table()`, `SELECT fn_advise_session_router('<session_id>', '[]'::jsonb)`, `SELECT * FROM aisha_evaluate_provider_for_task('chat', '{}'::jsonb)`",
    "- HTTP (service-role): `GET /providers/evaluate?task_kind=chat`, `POST /openclaw/resolve-clow`, `POST /mcp/test`",
    "- CLI: `aisha-dirigent advise-router --session-id <id>`",
    "",
  );

  return lines.join("\n");
}
