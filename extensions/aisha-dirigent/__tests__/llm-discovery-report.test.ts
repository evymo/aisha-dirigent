/**
 * llm-discovery-report.test.ts — workbench models flow into the central registry.
 *
 * reportDiscoveredModels reports each discovered local model to
 * upsert_discovered_model (with workbench provenance), deduped per session, soft on
 * any registry failure so local discovery is never broken.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/backend-rpc", () => ({ callRpc: vi.fn() }));
vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({ aishaUrl: "http://localhost:57421", llm: { presets: {} } })),
}));
vi.mock("../src/resource-tracker", () => ({ recordApiCall: vi.fn() }));

import { callRpc } from "../src/backend-rpc";
import { reportDiscoveredModels, type DiscoveredModel } from "../src/llm-discovery";

const mockCallRpc = vi.mocked(callRpc);
const model = (provider: string, modelId: string): DiscoveredModel => ({ provider, presetName: provider, modelId });

describe("reportDiscoveredModels", () => {
  beforeEach(() => mockCallRpc.mockReset());

  it("reports each discovered model with workbench provenance + alphabetical params", async () => {
    mockCallRpc.mockResolvedValue({ data: { model_registry_id: "x" }, stats: null });
    const n = await reportDiscoveredModels([model("ollama", "llama3"), model("vllm", "mistral")], new Set());
    expect(n).toBe(2);
    expect(mockCallRpc).toHaveBeenCalledWith("upsert_discovered_model", {
      p_model_id: "llama3",
      p_provider: "ollama",
      p_provider_metadata: { source: "workbench" },
    });
  });

  it("dedups — a model already in `seen` is not re-reported", async () => {
    mockCallRpc.mockResolvedValue({ data: { ok: true }, stats: null });
    const n = await reportDiscoveredModels([model("ollama", "llama3")], new Set(["ollama:llama3"]));
    expect(n).toBe(0);
    expect(mockCallRpc).not.toHaveBeenCalled();
  });

  it("soft on a degraded report (data=null) — never breaks discovery, not marked seen, retryable", async () => {
    // callRpc returns {data:null} (no auth/gateway) rather than throwing — the
    // realistic soft-failure path. The model is NOT marked seen, so the next
    // discovery cycle retries it.
    mockCallRpc.mockResolvedValue({ data: null, stats: null });
    const seen = new Set<string>();
    const n = await reportDiscoveredModels([model("ollama", "llama3")], seen);
    expect(n).toBe(0);
    expect(seen.has("ollama:llama3")).toBe(false);
  });
});
