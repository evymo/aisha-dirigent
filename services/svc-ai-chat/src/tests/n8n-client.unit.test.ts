/**
 * Unit tests for lib/n8n-client.ts — the SSRF-guarded, fail-loud n8n REST client
 * behind the Flowboard n8n engine target.
 *
 * Locked-in invariants:
 *   - not configured → throws (the route maps it to 503; NEVER a silent sandbox fallback)
 *   - unresolved __REMAP__ placeholders → throws BEFORE any network call (gap #7)
 *   - non-2xx create/activate → throws with the status (never swallowed)
 *   - the create body preserves `meta` (meta.flowboardNodeMap is the per-node
 *     provenance seam read by /flowboard-n8n-callback)
 *   - every call goes through the SSRF guard's safeFetch, never bare fetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { N8nWorkflow } from "@aisha/flowboard-core";

// Control the n8n config per-test by mutating the mocked object.
vi.mock("../config.js", () => ({
  config: { n8nBaseUrl: "http://n8n:5678", n8nApiKey: "k", ssrfHostAllowlist: "" },
}));
// SSRF guard has its own tests (packages/security) — here it is a passthrough that
// RECORDS it was used, so the global-fetch stub is reached and the n8n-client logic
// is exercised in isolation.
const guardUsed = vi.hoisted(() => ({ count: 0, allowlists: [] as string[][] }));
vi.mock("@aisha/security", () => ({
  createSsrfGuard: (opts: { hostAllowlist: string[] }) => {
    guardUsed.allowlists.push(opts.hostAllowlist);
    return {
      safeFetch: (url: string, init?: RequestInit) => {
        guardUsed.count += 1;
        return fetch(url, init);
      },
      check: vi.fn(),
    };
  },
  parseHostAllowlist: (v: string | undefined) =>
    (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import {
  pushWorkflowToN8n,
  activateWorkflowInN8n,
  findUnresolvedPlaceholders,
  N8nEngineError,
} from "../lib/n8n-client.js";
import { config } from "../config.js";

// config exposes readonly props; the mock object is mutable at runtime — cast to flip values per-test.
const cfg = config as { n8nBaseUrl: string; n8nApiKey: string; ssrfHostAllowlist: string };

function workflow(over: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    name: "Flow",
    nodes: [{ id: "n1", name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 1, position: [0, 0], parameters: {} }],
    connections: {},
    settings: {},
    meta: { generatedBy: "aisha-flowboard", flowboardNodeMap: { Webhook: { id: "n1", typeId: "trigger.webhook" } } },
    ...over,
  };
}

const okResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

describe("n8n-client", () => {
  beforeEach(() => {
    cfg.n8nBaseUrl = "http://n8n:5678";
    cfg.n8nApiKey = "k";
    cfg.ssrfHostAllowlist = "";
    guardUsed.count = 0;
    guardUsed.allowlists = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("findUnresolvedPlaceholders", () => {
    it("flags nodes whose parameters still carry a __REMAP__ placeholder", () => {
      const wf = workflow({
        nodes: [
          { id: "a", name: "Clean", type: "t", typeVersion: 1, position: [0, 0], parameters: { x: 1 } },
          { id: "b", name: "Dirty", type: "t", typeVersion: 1, position: [0, 0], parameters: { cred: "__REMAP__" } },
        ],
      });
      expect(findUnresolvedPlaceholders(wf)).toEqual(["Dirty"]);
    });

    it("returns [] for a clean workflow", () => {
      expect(findUnresolvedPlaceholders(workflow())).toEqual([]);
    });
  });

  describe("pushWorkflowToN8n (fail-loud)", () => {
    it("throws not_configured when base url / api key are missing — never a silent fallback", async () => {
      cfg.n8nBaseUrl = "";
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      await expect(pushWorkflowToN8n(workflow())).rejects.toMatchObject({ code: "not_configured" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws unresolved_placeholder and never calls n8n (gap #7 — no runtime remapper)", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const wf = workflow({ nodes: [{ id: "b", name: "Cred", type: "t", typeVersion: 1, position: [0, 0], parameters: { cred: "__REMAP__" } }] });
      await expect(pushWorkflowToN8n(wf)).rejects.toMatchObject({ code: "unresolved_placeholder" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws push_failed when the compiled workflow has no nodes", async () => {
      vi.stubGlobal("fetch", vi.fn());
      await expect(pushWorkflowToN8n(workflow({ nodes: [] }))).rejects.toMatchObject({ code: "push_failed" });
    });

    it("creates the workflow via the SSRF guard and returns the n8n id (handles { data } envelope)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(okResponse({ data: { id: "wf42", name: "Flow", active: true } }));
      vi.stubGlobal("fetch", fetchSpy);
      const res = await pushWorkflowToN8n(workflow());
      expect(res).toEqual({ workflowId: "wf42", active: true, name: "Flow" });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("http://n8n:5678/api/v1/workflows");
      expect((init as RequestInit).method).toBe("POST");
      expect(((init as RequestInit).headers as Record<string, string>)["X-N8N-API-Key"]).toBe("k");
      expect(guardUsed.count).toBe(1); // went through safeFetch, not bare fetch
      // the configured n8n host is the trust anchor — always in the guard allowlist
      expect(guardUsed.allowlists[0]).toContain("n8n");
    });

    it("preserves meta.flowboardNodeMap in the create body (per-node provenance seam)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(okResponse({ id: "wf1", name: "Flow", active: false }));
      vi.stubGlobal("fetch", fetchSpy);
      await pushWorkflowToN8n(workflow());
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
        meta?: { flowboardNodeMap?: Record<string, unknown> };
      };
      expect(body.meta?.flowboardNodeMap).toBeTruthy();
    });

    it("propagates a non-2xx from n8n as push_failed with the status", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ message: "bad" }, 400)));
      await expect(pushWorkflowToN8n(workflow())).rejects.toMatchObject({ code: "push_failed", status: 400 });
    });

    it("throws push_failed when n8n accepts the workflow but returns no id", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ name: "Flow" })));
      await expect(pushWorkflowToN8n(workflow())).rejects.toMatchObject({ code: "push_failed" });
    });

    it("wraps a network/timeout/SSRF error as push_failed", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
      const err = await pushWorkflowToN8n(workflow()).catch((e) => e);
      expect(err).toBeInstanceOf(N8nEngineError);
      expect(err.code).toBe("push_failed");
    });
  });

  describe("activateWorkflowInN8n (fail-loud)", () => {
    it("POSTs the activate endpoint through the SSRF guard", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(okResponse({ id: "wf42", active: true }));
      vi.stubGlobal("fetch", fetchSpy);
      await activateWorkflowInN8n("wf42");
      expect(fetchSpy.mock.calls[0][0]).toBe("http://n8n:5678/api/v1/workflows/wf42/activate");
      expect(guardUsed.count).toBe(1);
    });

    it("throws push_failed on a non-2xx activate (created-but-inactive = partial failure)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ message: "no trigger" }, 400)));
      await expect(activateWorkflowInN8n("wf42")).rejects.toMatchObject({ code: "push_failed", status: 400 });
    });

    it("throws not_configured when n8n is not configured", async () => {
      cfg.n8nApiKey = "";
      vi.stubGlobal("fetch", vi.fn());
      await expect(activateWorkflowInN8n("wf42")).rejects.toMatchObject({ code: "not_configured" });
    });
  });
});
