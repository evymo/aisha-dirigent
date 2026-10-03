/**
 * partner-metrics — behaviour tests against a fake SandboxContext.
 *
 * This plugin is the REFERENCE for the sandbox API surface, so the parts worth
 * pinning are the ones a copy-pasting author would inherit: that an unknown
 * capability is answered rather than thrown, that a failed RPC degrades to null
 * instead of taking the tick down, that missing vendor fields become 0 rather
 * than NaN, and that history is actually pruned (an unbounded KV namespace is
 * the kind of leak nobody notices until it is large).
 *
 * The whole point of the sandbox is that a plugin touches nothing directly, so
 * a plain object is a complete test double — no infrastructure required.
 */
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — the reference plugin is deliberately untyped JS-in-TS; it
// documents the ctx surface by example, and typing it here would test our
// annotations rather than its behaviour.
import { handle, init, dispose } from "../index.ts";

type Snapshot = Record<string, unknown>;

function makeCtx(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>();
  const logs: Array<{ level: string; msg: string }> = [];
  const scheduled: Array<{ cron: string; capability: string }> = [];

  const ctx: Record<string, unknown> = {
    plugin: { id: "partner-metrics", version: "0.1.0" },
    tenant: { id: "tenant-1", name: "Test Partner" },
    config: {},
    log: (level: string, msg: string) => void logs.push({ level, msg }),
    schedule: (cron: string, capability: string) => void scheduled.push({ cron, capability }),
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: unknown) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
      list: async (prefix: string) => [...store.keys()].filter((k) => k.startsWith(prefix)).sort(),
    },
    rpc: vi.fn(async () => ({
      active_users: 12,
      completed_projects: 3,
      avg_satisfaction: 8.5,
      revenue_estimate: 4200,
    })),
    llm: { chat: vi.fn(async () => "A concise summary.") },
    ...overrides,
  };
  return { ctx, store, logs, scheduled };
}

describe("partner-metrics", () => {
  it("registers the daily rollup on init", async () => {
    const { ctx, scheduled } = makeCtx();
    await init(ctx);
    expect(scheduled).toEqual([{ cron: "0 2 * * *", capability: "cron.daily_rollup" }]);
  });

  it("answers an unknown capability instead of throwing", async () => {
    const { ctx } = makeCtx();
    const res = await handle(ctx, "http.GET./nope");
    // A sandboxed plugin that throws on an unknown route turns a caller's typo
    // into an incident; shaped error + warn log is the contract.
    expect(res).toMatchObject({ error: "Unknown capability", capability: "http.GET./nope" });
  });

  it("refresh persists a snapshot and /metrics reads it back", async () => {
    const { ctx } = makeCtx();
    const refreshed = await handle(ctx, "http.POST./refresh");
    expect(refreshed).toMatchObject({ refreshed: true });

    const metrics = (await handle(ctx, "http.GET./metrics")) as {
      current: Snapshot;
      history: Snapshot[];
    };
    expect(metrics.current).toMatchObject({
      activeUsers: 12,
      completedProjects: 3,
      averageSatisfaction: 8.5,
      revenueEstimate: 4200,
    });
    expect(metrics.history).toHaveLength(1);
  });

  it("coerces missing vendor fields to 0 rather than NaN", async () => {
    const { ctx } = makeCtx({ rpc: vi.fn(async () => ({ active_users: 5 })) });
    const res = (await handle(ctx, "http.POST./refresh")) as { snapshot: Snapshot };
    expect(res.snapshot).toMatchObject({
      activeUsers: 5,
      completedProjects: 0,
      averageSatisfaction: 0,
      revenueEstimate: 0,
    });
    // NaN would serialize to null in JSON and read as "no data" downstream —
    // indistinguishable from a genuine absence.
    expect(Object.values(res.snapshot).every((v) => !Number.isNaN(v))).toBe(true);
  });

  it("degrades to null when the RPC fails, and says so in the log", async () => {
    const { ctx, logs } = makeCtx({
      rpc: vi.fn(async () => {
        throw new Error("PGRST202");
      }),
    });
    const res = (await handle(ctx, "http.POST./refresh")) as { snapshot: unknown };
    expect(res.snapshot).toBeNull();
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });

  it("prunes history beyond the 30-day window", async () => {
    const { ctx, store } = makeCtx();
    for (let i = 0; i < 35; i++) {
      // Deterministic, ordered keys — the plugin prunes by sorted key order.
      store.set(`metrics:history:2026-01-${String(i + 1).padStart(2, "0")}`, { date: "old" });
    }
    await handle(ctx, "http.POST./refresh");
    const remaining = [...store.keys()].filter((k) => k.startsWith("metrics:history:"));
    expect(remaining.length).toBeLessThanOrEqual(30);
  });

  it("/summary reports why it is empty instead of calling the model", async () => {
    const { ctx } = makeCtx();
    const res = (await handle(ctx, "http.GET./summary")) as { summary: unknown; reason: string };
    expect(res.summary).toBeNull();
    expect(res.reason).toMatch(/refresh/i);
    expect((ctx.llm as { chat: ReturnType<typeof vi.fn> }).chat).not.toHaveBeenCalled();
  });

  it("/summary uses the configured model once metrics exist", async () => {
    const { ctx } = makeCtx({ config: { summary_model: "claude-sonnet-5" } });
    await handle(ctx, "http.POST./refresh");
    const res = (await handle(ctx, "http.GET./summary")) as { model: string };
    expect(res.model).toBe("claude-sonnet-5");
    expect((ctx.llm as { chat: ReturnType<typeof vi.fn> }).chat).toHaveBeenCalledOnce();
  });

  it("/status reflects whether a snapshot exists", async () => {
    const { ctx } = makeCtx();
    expect(await handle(ctx, "http.GET./status")).toMatchObject({ hasMetrics: false });
    await handle(ctx, "http.POST./refresh");
    expect(await handle(ctx, "http.GET./status")).toMatchObject({ hasMetrics: true });
  });

  it("dispose is a clean no-op", async () => {
    const { ctx } = makeCtx();
    await expect(dispose(ctx)).resolves.toBeUndefined();
  });
});
