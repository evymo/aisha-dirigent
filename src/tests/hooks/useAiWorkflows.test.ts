import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useAiWorkflows,
  useAiWorkflow,
  useAiWorkflowNodeRuns,
  useCreateAiWorkflow,
  useUpdateAiWorkflow,
  useDeleteAiWorkflow,
} from "@/hooks/useAiWorkflows";

// ── Hoisted mocks ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.mockRpc,
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: () => true,
  }),
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: vi.fn(),
}));

// ── Test wrapper with QueryClientProvider ──────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ── Sample data ────────────────────────────────────────────────

const sampleWorkflow = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "default_chat_pipeline",
  display_name: "Default Chat Pipeline",
  description: "Standard classify → specialist → main_agent → simplicity flow",
  graph: {
    entry: "classify",
    nodes: {
      classify: {
        type: "classifier",
        agent: "classify",
        transitions: { __default__: "main_agent" },
      },
      main_agent: {
        type: "agent",
        agent: "main_agent",
        next: null,
      },
    },
  },
  context: "chat",
  is_active: true,
  version: 1,
  metadata: {},
  created_at: "2026-03-02T00:00:00Z",
  updated_at: "2026-03-02T00:00:00Z",
  created_by: null,
  updated_by: null,
};

const sampleNodeRun = {
  id: "00000000-0000-0000-0000-000000000010",
  run_id: "00000000-0000-0000-0000-000000000099",
  node_id: "classify",
  node_type: "classifier",
  agent_name: "classify",
  status: "completed",
  output_data: { text_length: 42 },
  transition_key: "Health",
  started_at: "2026-03-02T00:00:00Z",
  ended_at: "2026-03-02T00:00:01Z",
  duration_ms: 800,
  tokens_input: 120,
  tokens_output: 15,
  error_message: null,
  metadata: {},
};

// ── Tests ──────────────────────────────────────────────────────

describe("useAiWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list workflow definitions from RPC", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleWorkflow],
      error: null,
    });

    const { result } = renderHook(() => useAiWorkflows(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("default_chat_pipeline");
    expect(result.current.data?.[0].graph.entry).toBe("classify");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_ai_workflows_admin");
  });

  it("should handle RPC error gracefully", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Permission denied" },
    });

    const { result } = renderHook(() => useAiWorkflows(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Permission denied");
  });

  it("should return empty array for null data", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useAiWorkflows(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useAiWorkflow (single)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a single workflow by ID", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleWorkflow],
      error: null,
    });

    const { result } = renderHook(
      () => useAiWorkflow(sampleWorkflow.id),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.name).toBe("default_chat_pipeline");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_ai_workflow_admin", {
      p_workflow_id: sampleWorkflow.id,
    });
  });

  it("should return null when workflow not found", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useAiWorkflow("non-existent-id"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("should not fetch when workflowId is null", async () => {
    renderHook(() => useAiWorkflow(null), { wrapper: createWrapper() });

    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });
});

describe("useAiWorkflowNodeRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch node runs for a given run ID", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleNodeRun],
      error: null,
    });

    const { result } = renderHook(
      () => useAiWorkflowNodeRuns(sampleNodeRun.run_id),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].node_id).toBe("classify");
    expect(result.current.data?.[0].status).toBe("completed");
    expect(result.current.data?.[0].duration_ms).toBe(800);
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_workflow_run_nodes_admin", {
      p_run_id: sampleNodeRun.run_id,
    });
  });

  it("should not fetch when runId is null", async () => {
    renderHook(() => useAiWorkflowNodeRuns(null), { wrapper: createWrapper() });

    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });
});

describe("useCreateAiWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call create RPC with correct parameters", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: "new-workflow-uuid",
      error: null,
    });

    const { result } = renderHook(() => useCreateAiWorkflow(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      name: "test-workflow",
      display_name: "Test Workflow",
      graph: {
        entry: "start",
        nodes: { start: { type: "agent", agent: "main_agent", next: null } },
      },
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "create_ai_workflow_admin",
      expect.objectContaining({
        p_name: "test-workflow",
        p_display_name: "Test Workflow",
        p_context: "chat",
        p_is_active: false,
      }),
    );
  });
});

describe("useUpdateAiWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call update RPC with correct parameters", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUpdateAiWorkflow(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      workflow_id: sampleWorkflow.id,
      display_name: "Updated Name",
      is_active: true,
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "update_ai_workflow_admin",
      expect.objectContaining({
        p_workflow_id: sampleWorkflow.id,
        p_display_name: "Updated Name",
        p_is_active: true,
      }),
    );
  });
});

describe("useDeleteAiWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call delete RPC with workflow ID", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useDeleteAiWorkflow(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync(sampleWorkflow.id);

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "delete_ai_workflow_admin",
      { p_workflow_id: sampleWorkflow.id },
    );
  });

  it("should propagate RPC errors", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Workflow not found" },
    });

    const { result } = renderHook(() => useDeleteAiWorkflow(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync(sampleWorkflow.id),
    ).rejects.toThrow("Workflow not found");
  });
});
