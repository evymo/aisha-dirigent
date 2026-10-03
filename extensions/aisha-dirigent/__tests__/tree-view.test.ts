/**
 * tree-view.test.ts — Tree providers UI visibility.
 *
 * Tests: ModelsTreeProvider sections, DecisionsTreeProvider add/clear,
 *        SessionTreeProvider phase display.
 *
 * Heavy mocking — tree-view.ts imports 7+ modules.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../src/participant", () => ({
  getActiveSessionId: vi.fn(() => "test-session-123"),
  onSessionChanged: {
    event: vi.fn(() => ({ dispose: () => {} })),
  },
  onDecisionMade: {
    event: vi.fn(() => ({ dispose: () => {} })),
  },
}));

vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({
    aishaUrl: "http://localhost:57421",
    storyId: null,
    expertiseLevel: "intermediate",
    instanceLabel: "",
    activeProfile: "local",
  })),
  getConnectionLabel: vi.fn(() => "Local Dev"),
  onConfigChanged: vi.fn(() => ({ dispose: () => {} })),
}));

vi.mock("../src/auth", () => ({
  getAuthState: vi.fn(() => ({
    isAuthenticated: false,
    userId: null,
    email: null,
    accessToken: null,
  })),
  onAuthStateChanged: vi.fn(() => ({ dispose: () => {} })),
}));

vi.mock("../src/llm-discovery", () => ({
  getDiscoveredModels: vi.fn(() => []),
  onModelsDiscovered: vi.fn(() => ({ dispose: () => {} })),
}));

vi.mock("../src/compute-tier", () => ({
  getEnvironment: vi.fn(() => ({
    edge: {
      available: false,
      models: [],
      endpoints: [],
      chip: { name: "Apple M2", cores: 8, arch: "arm64", memoryGb: 16, isAppleSilicon: true },
    },
    backend: { type: "self-hosted", url: "http://localhost:57421", label: "Local Dev" },
  })),
  onEnvironmentChanged: vi.fn(() => ({ dispose: () => {} })),
}));

vi.mock("../src/session-manager", () => ({
  onSessionStateChanged: vi.fn(() => ({ dispose: () => {} })),
  getWorkPhaseLabel: vi.fn(() => "idle"),
}));

vi.mock("../src/resource-tracker", () => ({
  onStatsChanged: vi.fn(() => ({ dispose: () => {} })),
  getSnapshot: vi.fn(() => ({
    uptimeMs: 5000,
    api: {},
    tokens: { prompt: 0, completion: 0, estimatedCostUsd: 0 },
    modelUsage: [],
    childProcesses: 0,
    lastReset: new Date().toISOString(),
  })),
  getAggregateTotals: vi.fn(() => ({
    totalCalls: 0,
    totalErrors: 0,
    totalBytes: 0,
    totalLatencyMs: 0,
  })),
  getModelUsage: vi.fn(() => []),
  formatTokens: vi.fn((n: number) => String(n)),
  formatCost: vi.fn((n: number) => `$${n.toFixed(3)}`),
  formatBytes: vi.fn((n: number) => `${n}B`),
  formatDuration: vi.fn((ms: number) => `${ms}ms`),
  ALL_CATEGORIES: ["rpc", "mcp", "n8n", "auth", "push", "llm-discovery", "context-sync"],
}));

// ── Fresh import helper ──────────────────────────────────────────────

interface FreshTreeMods {
  treeView: typeof import("../src/tree-view");
  llmMod: { getDiscoveredModels: Mock };
  tierMod: { getEnvironment: Mock };
  trackerMod: { getModelUsage: Mock };
  participantMod: { getActiveSessionId: Mock };
}

async function freshTreeView(): Promise<FreshTreeMods> {
  vi.resetModules();
  const treeView = await import("../src/tree-view");
  const llmMod = await import("../src/llm-discovery") as unknown as FreshTreeMods["llmMod"];
  const tierMod = await import("../src/compute-tier") as unknown as FreshTreeMods["tierMod"];
  const trackerMod = await import("../src/resource-tracker") as unknown as FreshTreeMods["trackerMod"];
  const participantMod = await import("../src/participant") as unknown as FreshTreeMods["participantMod"];
  return { treeView, llmMod, tierMod, trackerMod, participantMod };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("ModelsTreeProvider", () => {
  beforeEach(() => vi.resetModules());

  it("root always shows Backend Models section", async () => {
    const { treeView } = await freshTreeView();
    const provider = new treeView.ModelsTreeProvider();
    const children = provider.getChildren() as Array<{ label: string; section?: string; contextValue?: string }>;
    const backendSection = children.find((c) => c.contextValue === "section.backend");
    expect(backendSection).toBeDefined();
  });

  it("root shows Edge Models section when edge available", async () => {
    const { treeView, llmMod, tierMod } = await freshTreeView();
    llmMod.getDiscoveredModels.mockReturnValue([
      { provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" },
    ]);
    tierMod.getEnvironment.mockReturnValue({
      edge: {
        available: true,
        models: [{ provider: "ollama", presetName: "ollama-default", modelId: "llama3.2" }],
        endpoints: ["http://localhost:11434/v1"],
        chip: { name: "Apple M2", cores: 8, arch: "arm64", memoryGb: 16, isAppleSilicon: true },
      },
      backend: { type: "self-hosted", url: "http://localhost:57421", label: "Local Dev" },
    });
    const provider = new treeView.ModelsTreeProvider();
    const children = provider.getChildren() as Array<{ contextValue?: string }>;
    const edgeSection = children.find((c) => c.contextValue === "section.edge");
    expect(edgeSection).toBeDefined();
  });

  it("root hides Edge Models section when no edge", async () => {
    const { treeView, llmMod, tierMod } = await freshTreeView();
    llmMod.getDiscoveredModels.mockReturnValue([]);
    tierMod.getEnvironment.mockReturnValue({
      edge: {
        available: false,
        models: [],
        endpoints: [],
        chip: { name: "Apple M2", cores: 8, arch: "arm64", memoryGb: 16, isAppleSilicon: true },
      },
      backend: { type: "self-hosted", url: "http://localhost:57421", label: "Local Dev" },
    });
    const provider = new treeView.ModelsTreeProvider();
    const children = provider.getChildren() as Array<{ contextValue?: string }>;
    const edgeSection = children.find((c) => c.contextValue === "section.edge");
    expect(edgeSection).toBeUndefined();
  });

  it("root shows Model Usage section when usage data exists", async () => {
    const { treeView, trackerMod } = await freshTreeView();
    trackerMod.getModelUsage.mockReturnValue([
      { provider: "edge", modelId: "llama3.2", tier: "edge", promptTokens: 100, completionTokens: 50, callCount: 3, totalLatencyMs: 600 },
    ]);
    const provider = new treeView.ModelsTreeProvider();
    const children = provider.getChildren() as Array<{ contextValue?: string }>;
    const usageSection = children.find((c) => c.contextValue === "section.usage");
    expect(usageSection).toBeDefined();
  });

  it("root hides Model Usage section when no usage", async () => {
    const { treeView, trackerMod } = await freshTreeView();
    trackerMod.getModelUsage.mockReturnValue([]);
    const provider = new treeView.ModelsTreeProvider();
    const children = provider.getChildren() as Array<{ contextValue?: string }>;
    const usageSection = children.find((c) => c.contextValue === "section.usage");
    expect(usageSection).toBeUndefined();
  });

  it("updateModels makes models available in backend children", async () => {
    const { treeView } = await freshTreeView();
    const provider = new treeView.ModelsTreeProvider();
    provider.updateModels([
      { provider: "openai", model_id: "gpt-4o", eval_status: "approved", is_available: true, latest_eval_score: 0.95 },
      { provider: "openai", model_id: "gpt-4-turbo", eval_status: "tested", is_available: true, latest_eval_score: 0.89 },
    ]);
    const root = provider.getChildren() as Array<{ contextValue?: string }>;
    const backendSection = root.find((c) => c.contextValue === "section.backend");
    expect(backendSection).toBeDefined();
    // Get backend children
    const backendChildren = provider.getChildren(backendSection as never) as Array<{ label: string; description?: string }>;
    expect(backendChildren.length).toBeGreaterThanOrEqual(1);
    // Should have an openai provider group
    const openai = backendChildren.find((c) => c.label === "openai");
    expect(openai).toBeDefined();
  });
});

describe("DecisionsTreeProvider", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty when no session", async () => {
    const { treeView, participantMod } = await freshTreeView();
    participantMod.getActiveSessionId.mockReturnValue(null);
    const provider = new treeView.DecisionsTreeProvider();
    const children = provider.getChildren();
    expect(children).toHaveLength(0);
  });

  it("addDecision makes decision visible in getChildren", async () => {
    const { treeView, participantMod } = await freshTreeView();
    participantMod.getActiveSessionId.mockReturnValue("test-session-123");
    const provider = new treeView.DecisionsTreeProvider();
    provider.addDecision({
      type: "Domain",
      summary: "Assigned frontend domain",
      severity: "info",
      source: "directive",
      timestamp: new Date().toISOString(),
    });
    const children = provider.getChildren();
    expect(children).toHaveLength(1);
  });

  it("getDecisions returns copies of cached records", async () => {
    const { treeView, participantMod } = await freshTreeView();
    participantMod.getActiveSessionId.mockReturnValue("test-session-123");
    const provider = new treeView.DecisionsTreeProvider();
    provider.addDecision({
      type: "Task",
      summary: "Code review completed",
      severity: "info",
      source: "autoflow",
      timestamp: new Date().toISOString(),
    });
    const decisions = provider.getDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe("Task");
  });

  it("clear empties all decisions", async () => {
    const { treeView, participantMod } = await freshTreeView();
    participantMod.getActiveSessionId.mockReturnValue("test-session-123");
    const provider = new treeView.DecisionsTreeProvider();
    provider.addDecision({
      type: "Domain",
      summary: "Test",
      severity: "info",
      source: "manual",
      timestamp: new Date().toISOString(),
    });
    provider.clear();
    const children = provider.getChildren();
    expect(children).toHaveLength(0);
    expect(provider.getDecisions()).toHaveLength(0);
  });
});

describe("SessionTreeProvider", () => {
  beforeEach(() => vi.resetModules());

  it("shows session info when session is active", async () => {
    const { treeView, participantMod } = await freshTreeView();
    participantMod.getActiveSessionId.mockReturnValue("abc12345-dead-beef-1234-abcdef012345");
    const provider = new treeView.SessionTreeProvider();
    const children = provider.getChildren();
    expect(children.length).toBeGreaterThan(0);
  });
});
