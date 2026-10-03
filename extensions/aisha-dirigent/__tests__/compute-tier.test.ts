/**
 * compute-tier.test.ts — Environment detection & task routing.
 *
 * Tests: detectEnvironment, resolveTier, isEdgeFirstEnabled, getEnvironment,
 *        onEnvironmentChanged event.
 *
 * SECURITY CRITICAL: evaluate/compliance/orchestrate must NEVER route to edge.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({
    aishaUrl: "http://localhost:57421",
    mcpUrl: "http://localhost:57421",
    instanceLabel: "",
    llm: { presets: { "ollama-default": { baseUrl: "http://localhost:11434/v1" } } },
  })),
  resolveConnectionLabel: vi.fn(
    (url: string, label?: string) => label || url,
  ),
}));

vi.mock("../src/llm-discovery", () => ({
  getDiscoveredModels: vi.fn(() => []),
}));

vi.mock("../src/system-info", () => ({
  getChipInfo: vi.fn(() => ({
    name: "Apple M2 Pro",
    cores: 12,
    arch: "arm64",
    memoryGb: 32,
    isAppleSilicon: true,
  })),
}));

// ── Fresh import helper ──────────────────────────────────────────────

async function freshComputeTier() {
  vi.resetModules();
  const mod = await import("../src/compute-tier");
  const configMod = await import("../src/config") as unknown as { getDirigentConfig: Mock };
  const llmMod = await import("../src/llm-discovery") as unknown as { getDiscoveredModels: Mock };
  const { __setMockConfig, __clearMockConfig } = await import("./__mocks__/vscode");
  return { ...mod, configMod, llmMod, __setMockConfig, __clearMockConfig };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("detectEnvironment", () => {
  beforeEach(() => vi.resetModules());

  it("detects self-hosted backend from localhost URL", async () => {
    const { detectEnvironment } = await freshComputeTier();
    const env = detectEnvironment();
    expect(env.backend.type).toBe("self-hosted");
  });

  it("detects self-hosted backend from 127.0.0.1 URL", async () => {
    const { detectEnvironment, configMod } = await freshComputeTier();
    configMod.getDirigentConfig.mockReturnValue({
      aishaUrl: "http://127.0.0.1:57421",
      mcpUrl: "http://127.0.0.1:57421",
      instanceLabel: "",
      llm: { presets: {} },
    });
    const env = detectEnvironment();
    expect(env.backend.type).toBe("self-hosted");
  });

  it("detects cloud backend from remote URL", async () => {
    const { detectEnvironment, configMod } = await freshComputeTier();
    configMod.getDirigentConfig.mockReturnValue({
      aishaUrl: "https://api.evymo.com",
      mcpUrl: "https://api.evymo.com",
      instanceLabel: "",
      llm: { presets: {} },
    });
    const env = detectEnvironment();
    expect(env.backend.type).toBe("cloud");
  });

  it("detects 'none' backend when URL is empty", async () => {
    const { detectEnvironment, configMod } = await freshComputeTier();
    configMod.getDirigentConfig.mockReturnValue({
      aishaUrl: "",
      mcpUrl: "",
      instanceLabel: "",
      llm: { presets: {} },
    });
    const env = detectEnvironment();
    expect(env.backend.type).toBe("none");
    expect(env.backend.label).toBe("Not Connected");
  });

  it("detects edge unavailable when no models discovered", async () => {
    const { detectEnvironment } = await freshComputeTier();
    const env = detectEnvironment();
    expect(env.edge.available).toBe(false);
    expect(env.edge.models).toHaveLength(0);
  });

  it("detects edge available when models are discovered", async () => {
    const { detectEnvironment, llmMod } = await freshComputeTier();
    llmMod.getDiscoveredModels.mockReturnValue([
      { provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" },
    ]);
    const env = detectEnvironment();
    expect(env.edge.available).toBe(true);
    expect(env.edge.models).toHaveLength(1);
  });

  it("includes chip info from system-info", async () => {
    const { detectEnvironment } = await freshComputeTier();
    const env = detectEnvironment();
    expect(env.edge.chip.name).toBe("Apple M2 Pro");
    expect(env.edge.chip.cores).toBe(12);
    expect(env.edge.chip.isAppleSilicon).toBe(true);
  });

  it("deduplicates edge endpoints", async () => {
    const { detectEnvironment, llmMod } = await freshComputeTier();
    llmMod.getDiscoveredModels.mockReturnValue([
      { provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" },
      { provider: "ollama", presetName: "ollama-default", modelId: "mistral" },
    ]);
    const env = detectEnvironment();
    expect(env.edge.models).toHaveLength(2);
    // Both use same preset → 1 unique endpoint
    expect(env.edge.endpoints).toHaveLength(1);
  });
});

describe("onEnvironmentChanged", () => {
  beforeEach(() => vi.resetModules());

  it("fires on first detection", async () => {
    const { detectEnvironment, onEnvironmentChanged } = await freshComputeTier();
    const listener = vi.fn();
    onEnvironmentChanged(listener);
    detectEnvironment();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when environment is unchanged", async () => {
    const { detectEnvironment, onEnvironmentChanged } = await freshComputeTier();
    const listener = vi.fn();
    detectEnvironment(); // first call => caches
    onEnvironmentChanged(listener);
    detectEnvironment(); // same state => no fire
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("getEnvironment", () => {
  beforeEach(() => vi.resetModules());

  it("auto-detects on first call and returns cached result", async () => {
    const { getEnvironment } = await freshComputeTier();
    const env1 = getEnvironment();
    const env2 = getEnvironment();
    expect(env1).toBe(env2); // same reference = cached
    expect(env1.backend.type).toBeTruthy();
  });
});

describe("isEdgeFirstEnabled", () => {
  beforeEach(() => vi.resetModules());

  it("returns false by default", async () => {
    const { isEdgeFirstEnabled } = await freshComputeTier();
    expect(isEdgeFirstEnabled()).toBe(false);
  });

  it("returns true when aisha.dirigent.edgeFirst is set", async () => {
    const { isEdgeFirstEnabled, __setMockConfig } = await freshComputeTier();
    __setMockConfig("aisha.dirigent.edgeFirst", true);
    expect(isEdgeFirstEnabled()).toBe(true);
  });
});

describe("resolveTier — SECURITY", () => {
  beforeEach(() => vi.resetModules());

  it.each(["evaluate", "compliance", "orchestrate"] as const)(
    "%s task NEVER routes to edge even with edgeFirst + models",
    async (task) => {
      const { resolveTier, detectEnvironment, llmMod, __setMockConfig } = await freshComputeTier();
      __setMockConfig("aisha.dirigent.edgeFirst", true);
      llmMod.getDiscoveredModels.mockReturnValue([
        { provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" },
      ]);
      detectEnvironment(); // prime cache
      const result = resolveTier(task);
      expect(result.tier).not.toBe("edge");
      expect(result.model).toBeNull();
      expect(result.reason).toContain("backend");
    },
  );
});

describe("resolveTier — edge routing", () => {
  beforeEach(() => vi.resetModules());

  it.each(["collect", "recap", "filter"] as const)(
    "%s routes to backend when edgeFirst is disabled",
    async (task) => {
      const { resolveTier, detectEnvironment, llmMod } = await freshComputeTier();
      llmMod.getDiscoveredModels.mockReturnValue([
        { provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" },
      ]);
      detectEnvironment();
      const result = resolveTier(task);
      expect(result.tier).not.toBe("edge");
    },
  );

  it.each(["collect", "recap", "filter"] as const)(
    "%s routes to edge when edgeFirst enabled + models available",
    async (task) => {
      const { resolveTier, detectEnvironment, llmMod, __setMockConfig } = await freshComputeTier();
      __setMockConfig("aisha.dirigent.edgeFirst", true);
      llmMod.getDiscoveredModels.mockReturnValue([
        { provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" },
      ]);
      detectEnvironment();
      const result = resolveTier(task);
      expect(result.tier).toBe("edge");
      expect(result.model).toBe("llama3.2");
      expect(result.endpoint).toContain("localhost");
    },
  );

  it("falls back to backend when edgeFirst enabled but no models", async () => {
    vi.restoreAllMocks();
    const { resolveTier, detectEnvironment, llmMod, __setMockConfig } = await freshComputeTier();
    llmMod.getDiscoveredModels.mockReturnValue([]);
    __setMockConfig("aisha.dirigent.edgeFirst", true);
    detectEnvironment();
    const result = resolveTier("recap");
    expect(result.tier).not.toBe("edge");
    expect(result.reason).toContain("no local models");
  });
});
