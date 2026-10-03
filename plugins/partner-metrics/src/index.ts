/**
 * Partner Metrics Dashboard — AISHA Full-Stack Reference Plugin
 *
 * Demonstrates the SandboxContext API surface:
 *  - ctx.kv     — persist daily metric snapshots
 *  - ctx.rpc    — call whitelisted Supabase RPC functions
 *  - ctx.llm    — generate AI summaries of partner KPIs
 *  - ctx.log    — structured logging (routed to Langfuse)
 *  - ctx.schedule — register daily cron rollup
 *
 * All interaction happens through SandboxContext.
 * This plugin NEVER accesses infrastructure directly.
 *
 * @module
 */

// =============================================================================
// Types (local to this plugin)
// =============================================================================

/** Aggregated daily metrics snapshot. */
interface MetricSnapshot {
  readonly date: string;
  readonly activeUsers: number;
  readonly completedProjects: number;
  readonly averageSatisfaction: number;
  readonly revenueEstimate: number;
}

/** Full metrics response returned by GET /metrics. */
interface MetricsResponse {
  readonly current: MetricSnapshot | null;
  readonly history: MetricSnapshot[];
  readonly generatedAt: string;
}

// =============================================================================
// Constants
// =============================================================================

const KV_CURRENT_METRICS = "metrics:current";
const KV_HISTORY_PREFIX = "metrics:history:";
const MAX_HISTORY_DAYS = 30;

// =============================================================================
// Plugin Lifecycle
// =============================================================================

/**
 * Initialize the plugin — register daily rollup cron and log startup.
 */
export async function init(ctx) {
  ctx.log("info", "partner-metrics initializing", {
    version: ctx.plugin.version,
    tenant: ctx.tenant.id,
  });

  // Register daily metrics rollup
  // Host v cronu spustí capability `cron.daily_rollup` (větev v handle).
  ctx.schedule("0 2 * * *", "cron.daily_rollup");

  ctx.log("info", "partner-metrics ready");
}

/**
 * Handle incoming capability requests.
 *
 * Routes:
 *  - http.GET./status   → health check
 *  - http.GET./metrics  → return current + historical metrics
 *  - http.GET./summary  → AI-generated summary of current KPIs
 *  - http.POST./refresh → trigger manual metrics refresh
 */
export async function handle(ctx, capability, payload) {
  ctx.log("debug", "Handling capability", { capability });

  switch (capability) {
    case "http.GET./status":
      return handleStatus(ctx);

    case "http.GET./metrics":
      return handleGetMetrics(ctx);

    case "http.GET./summary":
      return handleGetSummary(ctx);

    case "http.POST./refresh":
      return handleRefresh(ctx);

    // ⛔ 2026-09-16: capability byla v manifestu i v rozvrhu, ale handle ji
    // neznal — plánovač by rollup nikdy nespustil (vrátil by „Unknown capability").
    case "cron.daily_rollup":
      ctx.log("info", "Running daily metrics rollup (cron)");
      return refreshMetrics(ctx);

    default:
      ctx.log("warn", "Unknown capability requested", { capability });
      return { error: "Unknown capability", capability };
  }
}

/**
 * Dispose — clean up. Nothing persistent to tear down in this plugin.
 */
export async function dispose(ctx) {
  ctx.log("info", "partner-metrics disposing", { tenant: ctx.tenant.id });
}

// =============================================================================
// Route Handlers
// =============================================================================

/** GET /status — simple health check. */
async function handleStatus(ctx) {
  const current = await ctx.kv.get(KV_CURRENT_METRICS);
  return {
    status: "ok",
    plugin: ctx.plugin.id,
    tenant: ctx.tenant.id,
    hasMetrics: current !== null,
  };
}

/** GET /metrics — return current snapshot and history. */
async function handleGetMetrics(ctx) {
  const current = await ctx.kv.get(KV_CURRENT_METRICS);
  const historyKeys = await ctx.kv.list(KV_HISTORY_PREFIX);

  const history = [];
  for (const key of historyKeys.slice(-MAX_HISTORY_DAYS)) {
    const snapshot = await ctx.kv.get(key);
    if (snapshot) {
      history.push(snapshot);
    }
  }

  const response = {
    current: current ?? null,
    history,
    generatedAt: new Date().toISOString(),
  };

  return response;
}

/** GET /summary — generate AI summary of current metrics. */
async function handleGetSummary(ctx) {
  const current = await ctx.kv.get(KV_CURRENT_METRICS);

  if (!current) {
    return {
      summary: null,
      reason: "No metrics available. Trigger POST /refresh first.",
    };
  }

  const model = ctx.config.summary_model ?? "gpt-4";

  const summary = await ctx.llm.chat(
    [
      {
        role: "system",
        content:
          "You are a concise business analyst. Summarize the following partner KPIs in 2-3 sentences. Focus on trends and actionable insights.",
      },
      {
        role: "user",
        content: `Partner: ${ctx.tenant.name}\nDate: ${current.date}\nActive Users: ${current.activeUsers}\nCompleted Projects: ${current.completedProjects}\nAvg Satisfaction: ${current.averageSatisfaction}/10\nRevenue Estimate: $${current.revenueEstimate}`,
      },
    ],
    { model, maxTokens: 200, temperature: 0.3 },
  );

  ctx.log("info", "AI summary generated", {
    model,
    metricsDate: current.date,
  });

  return { summary, metricsDate: current.date, model };
}

/** POST /refresh — manually trigger metrics aggregation. */
async function handleRefresh(ctx) {
  ctx.log("info", "Manual metrics refresh triggered");
  const snapshot = await refreshMetrics(ctx);
  return { refreshed: true, snapshot };
}

// =============================================================================
// Core Logic
// =============================================================================

/**
 * Fetch partner stats via RPC, build a snapshot, persist to KV store.
 *
 * Demonstrates:
 *  - ctx.rpc() — whitelisted RPC call
 *  - ctx.kv.set() — persist structured data
 */
async function refreshMetrics(ctx) {
  const today = new Date().toISOString().slice(0, 10);

  // Fetch raw stats from whitelisted RPC
  let stats;
  try {
    stats = await ctx.rpc("get_partner_stats", {
      p_partner_id: ctx.tenant.id,
    });
  } catch (err) {
    ctx.log("error", "Failed to fetch partner stats via RPC", {
      error: String(err),
    });
    return null;
  }

  // Build snapshot (defensive — handle missing/null fields)
  const snapshot = {
    date: today,
    activeUsers: Number(stats?.active_users ?? 0),
    completedProjects: Number(stats?.completed_projects ?? 0),
    averageSatisfaction: Number(stats?.avg_satisfaction ?? 0),
    revenueEstimate: Number(stats?.revenue_estimate ?? 0),
  };

  // Persist current + append to history
  await ctx.kv.set(KV_CURRENT_METRICS, snapshot);
  await ctx.kv.set(`${KV_HISTORY_PREFIX}${today}`, snapshot);

  ctx.log("info", "Metrics snapshot persisted", { date: today });

  // Prune old history entries
  const historyKeys = await ctx.kv.list(KV_HISTORY_PREFIX);
  if (historyKeys.length > MAX_HISTORY_DAYS) {
    const toDelete = historyKeys.slice(
      0,
      historyKeys.length - MAX_HISTORY_DAYS,
    );
    for (const key of toDelete) {
      await ctx.kv.delete(key);
    }
    ctx.log("info", "Pruned old metric history", { removed: toDelete.length });
  }

  return snapshot;
}
