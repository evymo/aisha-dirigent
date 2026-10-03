/**
 * scripts/dirigent/router-advise.mjs — `aisha-dirigent advise-router` workflow.
 *
 * Reads .aisha/session-cost.jsonl (local ledger written by the hook) and,
 * when an AISHA backend profile is configured, calls fn_advise_session_router
 * for the deeper analysis (read_ratio, rolling_cost from ai_trace_events,
 * suggested_slot / profile / model, batch_eligible_count, reasoning).
 *
 * Output: human-readable summary on stdout + structured payload via
 * persistWorkflowAudit. Pure read; advisory-only invariant.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SESSION_LEDGER = ".aisha/session-cost.jsonl";
const DIRIGENT_JSON = ".aisha/dirigent.json";

function readLocalCost() {
  if (!existsSync(SESSION_LEDGER)) {
    return { total: 0, tool_count: 0, events: [] };
  }
  const lines = readFileSync(SESSION_LEDGER, "utf-8")
    .split("\n")
    .filter(Boolean);
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  const events = [];
  let total = 0;
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (typeof ev.ts === "string" && new Date(ev.ts).getTime() >= cutoff) {
        events.push(ev);
        if (typeof ev.cost_usd === "number") total += ev.cost_usd;
      }
    } catch {
      // skip malformed line
    }
  }
  return { total, tool_count: events.length, events };
}

function readRouterCoachConfig() {
  if (!existsSync(DIRIGENT_JSON)) return null;
  try {
    const j = JSON.parse(readFileSync(DIRIGENT_JSON, "utf-8"));
    return j.routerCoach ?? null;
  } catch {
    return null;
  }
}

async function callAdvisorRpc(_config, sessionId, recentToolUses) {
  // Read canonical PostgREST endpoint env vars (no legacy profile field).
  // Helper kept simple — service-role token signs the read; advisory only.
  const url = process.env.POSTGREST_URL ?? process.env.AISHA_API_URL ?? null;
  const key = process.env.POSTGREST_SERVICE_TOKEN ?? process.env.AISHA_SERVICE_TOKEN ?? null;
  if (!url) return null;

  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rpc/fn_advise_session_router`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key ?? "",
          Authorization: `Bearer ${key ?? ""}`,
        },
        body: JSON.stringify({
          p_session_id: sessionId,
          p_recent_tool_uses: recentToolUses,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function runAdviseRouterWorkflow(config, { sessionId } = {}) {
  const local = readLocalCost();
  const rc = readRouterCoachConfig();
  const threshold = rc?.costThresholdUsd ?? 0.5;
  const currentProfile = rc?.slotProfile ?? "balanced";

  const advisory = await callAdvisorRpc(
    config,
    sessionId ?? "unknown",
    local.events.map((e) => ({ tool: e.tool, timestamp: e.ts })),
  );

  const overBudget = local.total > threshold;
  const summary = {
    session_id: sessionId,
    local_cost_usd: Number(local.total.toFixed(4)),
    threshold_usd: threshold,
    over_budget: overBudget,
    current_profile: currentProfile,
    tool_count: local.tool_count,
    rpc_advisory: advisory,
  };

  let recommendation = "no change";
  if (overBudget) {
    if (advisory?.suggested_profile && advisory.suggested_profile !== currentProfile) {
      recommendation = `switch to ${advisory.suggested_profile} via /aisha-router-config`;
    } else if (currentProfile !== "budget") {
      recommendation = "switch to budget via /aisha-router-config (~40% savings)";
    } else {
      recommendation = "already on budget; consider batch routing for long analyses";
    }
  }

  const lines = [
    "ROUTER-COACH",
    `What is happening: local cost $${summary.local_cost_usd} over ${summary.tool_count} tool uses; threshold $${threshold}.`,
    `Recommended: ${recommendation}`,
    `Why: ${advisory?.reasoning ?? "no backend advisory available; relying on local ledger only"}`,
  ];

  return {
    workflow: "advise-router",
    ok: true,
    summary,
    text: lines.join("\n"),
  };
}
