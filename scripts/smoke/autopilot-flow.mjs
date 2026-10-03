#!/usr/bin/env node
/**
 * scripts/smoke/autopilot-flow.mjs — production smoke test for the full
 * AISHA autopilot stack (Phase 1-5).
 *
 * Exercises every decision path AISHA can take, against a real deployed
 * backend. Each scenario is independent — failures in one don't block
 * others. Final report is JSON to stdout with pass/fail per scenario.
 *
 * Required env:
 *   POSTGREST_URL                (e.g. https://api.example.com)
 *   POSTGREST_SERVICE_TOKEN
 *
 * Optional env:
 *   SVC_AI_CHAT_URL              (e.g. http://svc-ai-chat:3020 or https://api.example.com)
 *   SVC_AI_CHAT_SERVICE_TOKEN
 *   AISHA_LLM_GATEWAY_URL        (verifies gateway health when set)
 *   OPENCLAW_URL                 (verifies OpenClaw advisory health when set)
 *
 * Usage:
 *   POSTGREST_URL=... POSTGREST_SERVICE_TOKEN=... node scripts/smoke/autopilot-flow.mjs
 *   npm run smoke:autopilot      (once added to package.json)
 *
 * Exit code: 0 if all scenarios pass, 1 otherwise.
 */

const POSTGREST_URL = process.env.POSTGREST_URL;
const POSTGREST_SERVICE_TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const SVC_AI_CHAT_URL = process.env.SVC_AI_CHAT_URL ?? "";
const SVC_AI_CHAT_SERVICE_TOKEN = process.env.SVC_AI_CHAT_SERVICE_TOKEN ?? "";
const AISHA_LLM_GATEWAY_URL = process.env.AISHA_LLM_GATEWAY_URL ?? "";
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "";

if (!POSTGREST_URL || !POSTGREST_SERVICE_TOKEN) {
  console.error("POSTGREST_URL and POSTGREST_SERVICE_TOKEN are required");
  process.exit(2);
}

const results = [];

async function rpc(name, args = {}) {
  const res = await fetch(`${POSTGREST_URL.replace(/\/$/, "")}/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${POSTGREST_SERVICE_TOKEN}`,
      apikey: POSTGREST_SERVICE_TOKEN,
      Accept: "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    console.warn(`[autopilot-flow] non-JSON response body (status ${res.status}): ${err instanceof Error ? err.message : String(err)}`);
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function run(name, fn) {
  const startedAt = Date.now();
  try {
    const out = await fn();
    results.push({
      scenario: name,
      ok: true,
      duration_ms: Date.now() - startedAt,
      output: out,
    });
    process.stderr.write(`  ✓ ${name} (${Date.now() - startedAt}ms)\n`);
  } catch (err) {
    results.push({
      scenario: name,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: String(err).slice(0, 500),
    });
    process.stderr.write(`  ✗ ${name}: ${String(err).slice(0, 200)}\n`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ============================================================================
// Scenario 1: AISHA chooses execution strategy for a normal chat task
// → expect strategy='sync', graph_id=null (no reflection graph needed)
// ============================================================================
await run("01-strategy-for-chat-task", async () => {
  const r = await rpc("aisha_choose_execution_strategy", {
    p_task: {
      description: "User asks: what is the weather today?",
      type: "chat",
      deadline_hours: 1,
      criticality: "normal",
      expected_tokens: 500,
      agent_slug: "aisha",
    },
    p_context: { budget_remaining: 5.0 },
  });
  assert(r.ok, `RPC failed: ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body?.strategy === "sync", `Expected strategy=sync, got ${r.body?.strategy}`);
  return { strategy: r.body.strategy, graph_slug: r.body.graph_slug };
});

// ============================================================================
// Scenario 2: AISHA chooses BATCH strategy for a deferrable analysis
// → expect strategy='batch', batch_eligible=true
// ============================================================================
await run("02-strategy-batch-eligible", async () => {
  const r = await rpc("aisha_choose_execution_strategy", {
    p_task: {
      description: "analyze last quarter audit journal entries and summarize",
      type: "analyze",
      deadline_hours: 48,
      criticality: "normal",
      expected_tokens: 80000,
      agent_slug: "aisha",
    },
    p_context: { budget_remaining: 5.0 },
  });
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(r.body?.batch_eligible === true, "Expected batch_eligible=true");
  return { strategy: r.body.strategy, eligible: r.body.batch_eligible };
});

// ============================================================================
// Scenario 3: AISHA chooses DEPLOY-REFLECT graph for a deploy task
// → expect graph_slug='deploy-reflect', required_capabilities includes cosmos_anchor
// ============================================================================
await run("03-strategy-deploy-reflect-graph", async () => {
  const r = await rpc("aisha_choose_execution_strategy", {
    p_task: {
      description: "deploy svc-new-feature blue-green to backend",
      type: "deploy",
      deadline_hours: 4,
      criticality: "normal",
      risk_level: "medium",
      expected_tokens: 15000,
      agent_slug: "dirigent",
    },
    p_context: { budget_remaining: 5.0 },
  });
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(r.body?.graph_slug === "deploy-reflect", `Expected deploy-reflect, got ${r.body?.graph_slug}`);
  const caps = r.body?.required_capabilities ?? [];
  assert(caps.includes("cosmos_anchor"), "Expected cosmos_anchor in required_capabilities");
  return { graph_slug: r.body.graph_slug, capabilities: caps };
});

// ============================================================================
// Scenario 4: budget_remaining < $1 forces budget profile
// ============================================================================
await run("04-strategy-budget-cap", async () => {
  const r = await rpc("aisha_choose_execution_strategy", {
    p_task: {
      description: "exploratory read of auth module",
      type: "chat",
      deadline_hours: 1,
      criticality: "normal",
      expected_tokens: 2000,
      agent_slug: "aisha",
    },
    p_context: { budget_remaining: 0.25 },
  });
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(r.body?.profile === "budget", `Expected profile=budget, got ${r.body?.profile}`);
  return { profile: r.body.profile };
});

// ============================================================================
// Scenario 5: Soulforge slot classification (DB-side) for read task
// ============================================================================
await run("05-soulforge-slot-spark", async () => {
  const r = await rpc("recommend_slot_for_task", {
    p_message: "read the README",
    p_context: {},
  });
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(r.body?.slot === "spark", `Expected spark, got ${r.body?.slot}`);
  return { slot: r.body.slot, confidence: r.body.confidence };
});

// ============================================================================
// Scenario 6: Slot routing table is queryable (no rows is fine for fresh deploys)
// ============================================================================
await run("06-soulforge-routing-table", async () => {
  const r = await rpc("get_slot_routing_table", {});
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(Array.isArray(r.body), `Expected array, got ${typeof r.body}`);
  return { row_count: r.body.length };
});

// ============================================================================
// Scenario 7: Per-clow backend resolver picks something or degrades cleanly
// ============================================================================
await run("07-resolve-clow-backend", async () => {
  const r = await rpc("aisha_resolve_clow_backend", {
    p_clow: {
      purpose: "explore the auth module to understand JWT handling",
      task_kind: "chat",
      capability_tags: ["retrieval"],
      expected_tokens: 3000,
      deadline_hours: 1,
      allow_batch: false,
      allow_local: true,
    },
    p_context: { budget_remaining: 5.0 },
  });
  assert(r.ok, `RPC failed: ${r.status} ${JSON.stringify(r.body)}`);
  // Either resolves with top + candidates OR returns fallback (both OK)
  assert(typeof r.body?.resolved === "boolean", "Expected resolved field");
  return {
    resolved: r.body.resolved,
    top_provider: r.body.top?.provider_slug,
    candidate_count: Array.isArray(r.body.candidates) ? r.body.candidates.length : 0,
  };
});

// ============================================================================
// Scenario 8: Provider evaluation returns ranked list for chat
// ============================================================================
await run("08-evaluate-providers-for-chat", async () => {
  const r = await rpc("aisha_evaluate_provider_for_task", {
    p_task_kind: "chat",
    p_filters: { include_local: true },
  });
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(Array.isArray(r.body), "Expected array result");
  return { provider_model_count: r.body.length };
});

// ============================================================================
// Scenario 9: Dirigent advisor reports rolling cost (empty session is fine)
// ============================================================================
await run("09-dirigent-advisor-empty-session", async () => {
  const r = await rpc("fn_advise_session_router", {
    p_session_id: "smoke-test-session-id",
    p_recent_tool_uses: [
      { tool: "Read", timestamp: new Date().toISOString() },
      { tool: "Grep", timestamp: new Date().toISOString() },
      { tool: "Edit", timestamp: new Date().toISOString() },
    ],
  });
  assert(r.ok, `RPC failed: ${r.status}`);
  assert(typeof r.body?.read_ratio === "number", "Expected read_ratio");
  assert(typeof r.body?.suggested_slot === "string", "Expected suggested_slot");
  return {
    read_ratio: r.body.read_ratio,
    suggested_slot: r.body.suggested_slot,
    rolling_cost: r.body.rolling_cost_usd,
  };
});

// ============================================================================
// Scenario 10: Hippocampus retrieves recent learnings (empty result on fresh deploy is OK)
// Note: this requires an embedding column populated; we test the RPC contract,
// not the retrieval. A null embedding param raises NOT NULL; we pass a real
// embedding only when one is locally available.
// ============================================================================
await run("10-hippocampus-search-contract", async () => {
  // Skip if no embedding query infrastructure available; we just verify the
  // RPC rejects a missing embedding cleanly rather than 500-ing.
  const r = await rpc("fn_search_learnings", {
    p_query_embedding: null,
    p_story_id: null,
    p_agent_slug: "aisha",
    p_limit: 5,
  });
  assert(!r.ok, "Expected RPC to reject null embedding");
  return { rejected_correctly: !r.ok, status: r.status };
});

// ============================================================================
// Scenario 11: Pilot graphs are seeded
// ============================================================================
await run("11-pilot-graphs-seeded", async () => {
  // All reflection graphs are generated into ai_workflow_definitions from their
  // .json SoT (scripts/db/gen-reflection-graph-seed.mjs). reasoning-tree-reflect
  // is the E1 single-run Tree-of-Thoughts graph — assert it lands on a real stack.
  const url = `${POSTGREST_URL.replace(/\/$/, "")}/ai_workflow_definitions?name=in.(deploy-reflect,story-plan-reflect,reasoning-tree-reflect)&select=name,is_active,context`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${POSTGREST_SERVICE_TOKEN}`,
      apikey: POSTGREST_SERVICE_TOKEN,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  assert(res.ok, `HTTP ${res.status}`);
  const rows = await res.json();
  assert(rows.length === 3, `Expected 3 reflection graphs, got ${rows.length}`);
  assert(
    rows.some((r) => r.name === "reasoning-tree-reflect" && r.is_active),
    "reasoning-tree-reflect (E1 ToT) must be seeded + active",
  );
  return { graphs: rows.map((r) => r.name) };
});

// ============================================================================
// Scenario 12: Provider registry has seeds for direct providers
// ============================================================================
await run("12-provider-registry-seeded", async () => {
  const url = `${POSTGREST_URL.replace(/\/$/, "")}/ai_provider_registry?select=slug,backend_kind,is_enabled&slug=in.(anthropic,openai,google-genai,llm-gateway)`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${POSTGREST_SERVICE_TOKEN}`,
      apikey: POSTGREST_SERVICE_TOKEN,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  assert(res.ok, `HTTP ${res.status}`);
  const rows = await res.json();
  assert(rows.length === 4, `Expected 4 seeded providers, got ${rows.length}`);
  return { providers: rows };
});

// ============================================================================
// Scenario 13: MCP server registry has aisha-knowledge seeded
// ============================================================================
await run("13-mcp-registry-aisha-knowledge", async () => {
  const url = `${POSTGREST_URL.replace(/\/$/, "")}/mcp_server_registry?slug=eq.aisha-knowledge&select=slug,status,transport`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${POSTGREST_SERVICE_TOKEN}`,
      apikey: POSTGREST_SERVICE_TOKEN,
      Accept: "application/json",
    },
  });
  assert(res.ok, `HTTP ${res.status}`);
  const rows = await res.json();
  assert(rows.length === 1, "Expected aisha-knowledge MCP row");
  return rows[0];
});

// ============================================================================
// Scenario 14: LLM Gateway health (when configured)
// ============================================================================
if (AISHA_LLM_GATEWAY_URL) {
  await run("14-llm-gateway-health", async () => {
    const res = await fetch(`${AISHA_LLM_GATEWAY_URL.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert(res.ok, `HTTP ${res.status}`);
    return { status: res.status };
  });
}

// ============================================================================
// Scenario 15: OpenClaw health (when configured)
// ============================================================================
if (OPENCLAW_URL) {
  await run("15-openclaw-health", async () => {
    const res = await fetch(`${OPENCLAW_URL.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert(res.ok, `HTTP ${res.status}`);
    return { status: res.status };
  });
}

// ============================================================================
// Scenario 16: svc-ai-chat /reflect/runs route auth gate (when configured)
// ============================================================================
if (SVC_AI_CHAT_URL && SVC_AI_CHAT_SERVICE_TOKEN) {
  await run("16-reflect-route-auth-gate", async () => {
    // Send a bad request — the route should reject 400/401 (not 500).
    const res = await fetch(`${SVC_AI_CHAT_URL.replace(/\/$/, "")}/reflect/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SVC_AI_CHAT_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
    assert([400, 401, 403].includes(res.status), `Expected 400/401/403, got ${res.status}`);
    return { status: res.status };
  });
}

// ============================================================================
// Report
// ============================================================================
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
const total = results.length;

const report = {
  generated_at: new Date().toISOString(),
  postgrest_url: POSTGREST_URL,
  summary: { total, passed, failed },
  scenarios: results,
};

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.stderr.write(`\n[smoke] ${passed}/${total} passed (${failed} failed)\n`);
process.exit(failed === 0 ? 0 : 1);
