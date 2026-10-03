// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

/** Organism acceptance A→Z over the REAL PostgREST wire (fetch+env only; skips without a backend).
 *  Live organs (S2–S7/S10–S12) are it.skip stubs — flesh out on a running stack (E2E_ORGANISM_BLUEPRINTS.md). */
const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = !!BASE && !!TOKEN;

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

beforeAll(() => { if (!RUN) console.warn("[organism-rpc-e2e] skipped — set POSTGREST_URL + POSTGREST_SERVICE_TOKEN."); });

describe.skipIf(!RUN)("Organism over PostgREST wire (S1/S8/S9 live)", () => {
  it("S1: resolver returns a scored top candidate", async () => {
    const r = (await rpc("aisha_resolve_clow_backend", { p_clow: { purpose: "organism e2e", task_kind: "chat" }, p_context: {} })) as { resolved?: boolean; top?: { model_id?: string; score?: number } };
    expect(r.resolved).toBe(true);
    expect(r.top?.model_id).toBeTruthy();
    expect(typeof r.top?.score).toBe("number");
  });
  it("S8: admit does not silently allow needs_write on direct_llm", async () => {
    const r = (await rpc("fn_admit_clow", { p_clow: { purpose: "needs write", runtime: "direct_llm", needs_write: true }, p_context: {} })) as { decision?: string };
    expect(["allow", "ask", "deny"]).toContain(r.decision);
    expect(r.decision).not.toBe("allow");
  });
  it("S9: rollup runs and returns a count", async () => {
    const n = (await rpc("fn_rollup_outcomes_to_benchmark", { p_window_hours: 1, p_min_samples: 1 })) as number;
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThanOrEqual(0);
  });
  it("T1: normalize_task_kind normalizes dirty input", async () => {
    expect((await rpc("normalize_task_kind", { p_raw: "  Foo Bar " })) as string).toBe("foo_bar");
  });
});

describe("Organism live executors + full-stack (acceptance — flesh out on running stack)", () => {
  it.skip("S2 direct_llm [fullenv]", () => {});
  it.skip("S3 openclaw [fullenv]", () => {});
  it.skip("S4 hermes [fullenv]", () => {});
  it.skip("S5 cli Docker [OMNI_ACCEPTANCE]", () => {});
  it.skip("S6 workbench [fullenv]", () => {});
  it.skip("S7 batch [flowboard:n8n]", () => {});
  it.skip("S10 multilingual [realllm]", () => {});
  it.skip("S11 ingress lanes [acceptance]", () => {});
  it.skip("S12 heartbeat [OMNI_ACCEPTANCE]", () => {});
});
