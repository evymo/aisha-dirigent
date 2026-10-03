import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useAiTriggers,
  useAiTrigger,
  useCreateAiTrigger,
  useUpdateAiTrigger,
  useDeleteAiTrigger,
  useProactiveRuns,
  useAiScheduledJobs,
  useCreateAiScheduledJob,
} from "@/hooks/useAiProactive";

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

const sampleTrigger = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "high_pain_alert",
  display_name: "High Pain Alert",
  description: "Triggers when pain level exceeds threshold",
  source_table: "health_check_ins",
  source_event: "INSERT",
  condition: { field: "pain_level", operator: ">", value: 7 },
  action_type: "analyze" as const,
  agent_name: "health_monitor",
  workflow_name: null,
  action_config: { include_history: true },
  target_roles: ["member"],
  priority: "high" as const,
  is_active: true,
  cooldown_minutes: 1440,
  metadata: null,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T00:00:00Z",
};

const sampleTriggerDetail = {
  ...sampleTrigger,
  created_by: "22222222-2222-2222-2222-222222222222",
  updated_by: null,
};

const sampleRun = {
  id: "33333333-3333-3333-3333-333333333333",
  trigger_definition_id: sampleTrigger.id,
  trigger_name: "high_pain_alert",
  user_id: "44444444-4444-4444-4444-444444444444",
  source_record_id: "55555555-5555-5555-5555-555555555555",
  status: "completed" as const,
  action_taken: "analyze",
  output_text: "Elevated pain levels detected. Consider...",
  started_at: "2026-03-01T10:00:00Z",
  completed_at: "2026-03-01T10:00:02Z",
  duration_ms: 2000,
  tokens_input: 150,
  tokens_output: 80,
  error_message: null,
  created_at: "2026-03-01T10:00:00Z",
};

const sampleScheduledJob = {
  id: "66666666-6666-6666-6666-666666666666",
  name: "daily_health_insights",
  display_name: "Daily Health Insights",
  description: "Generates daily health summaries",
  cron_expression: "0 8 * * *",
  job_type: "ai_analysis",
  agent_name: "health_insights",
  workflow_name: null,
  job_config: { include_trends: true },
  is_active: true,
  last_run_at: "2026-03-01T08:00:00Z",
  last_run_status: "success",
  last_run_duration_ms: 3500,
  next_run_at: "2026-03-02T08:00:00Z",
  total_runs: 10,
  successful_runs: 9,
  failed_runs: 1,
  metadata: null,
  created_at: "2026-03-01T00:00:00Z",
};

// ============================================================================
// Trigger Definitions
// ============================================================================

describe("useAiTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list trigger definitions from RPC", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleTrigger],
      error: null,
    });

    const { result } = renderHook(() => useAiTriggers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("high_pain_alert");
    expect(result.current.data?.[0].priority).toBe("high");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_ai_triggers_admin");
  });

  it("should handle RPC error gracefully", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const { result } = renderHook(() => useAiTriggers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied");
  });
});

describe("useAiTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a single trigger by ID", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleTriggerDetail],
      error: null,
    });

    const { result } = renderHook(
      () => useAiTrigger(sampleTrigger.id),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.name).toBe("high_pain_alert");
    expect(result.current.data?.created_by).toBe(sampleTriggerDetail.created_by);
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_ai_trigger_admin", {
      p_trigger_id: sampleTrigger.id,
    });
  });

  it("should not fetch when triggerId is undefined", async () => {
    const { result } = renderHook(
      () => useAiTrigger(undefined),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });
});

describe("useCreateAiTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call create RPC with correct parameters", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: "new-trigger-uuid",
      error: null,
    });

    const { result } = renderHook(() => useCreateAiTrigger(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      name: "new_trigger",
      display_name: "New Trigger",
      source_table: "health_check_ins",
      action_type: "alert",
      priority: "critical",
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "create_ai_trigger_admin",
      expect.objectContaining({
        p_name: "new_trigger",
        p_display_name: "New Trigger",
        p_source_table: "health_check_ins",
        p_action_type: "alert",
        p_priority: "critical",
      }),
    );
  });
});

describe("useUpdateAiTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call update RPC with correct parameters", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useUpdateAiTrigger(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      trigger_id: sampleTrigger.id,
      is_active: false,
      priority: "low",
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "update_ai_trigger_admin",
      expect.objectContaining({
        p_trigger_id: sampleTrigger.id,
        p_is_active: false,
        p_priority: "low",
      }),
    );
  });
});

describe("useDeleteAiTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call delete RPC with trigger ID", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useDeleteAiTrigger(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync(sampleTrigger.id);

    expect(hoisted.mockRpc).toHaveBeenCalledWith("delete_ai_trigger_admin", {
      p_trigger_id: sampleTrigger.id,
    });
  });
});

// ============================================================================
// Proactive Runs
// ============================================================================

describe("useProactiveRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list proactive runs from RPC", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleRun],
      error: null,
    });

    const { result } = renderHook(
      () => useProactiveRuns({ status: "completed" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].status).toBe("completed");
    expect(result.current.data?.[0].trigger_name).toBe("high_pain_alert");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_proactive_runs_admin", {
      p_trigger_id: undefined,
      p_user_id: undefined,
      p_status: "completed",
      p_limit: 50,
    });
  });

  it("should use defaults when no filters provided", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(
      () => useProactiveRuns(),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_proactive_runs_admin", {
      p_trigger_id: undefined,
      p_user_id: undefined,
      p_status: undefined,
      p_limit: 50,
    });
  });
});

// ============================================================================
// Scheduled Jobs
// ============================================================================

describe("useAiScheduledJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list scheduled jobs from RPC", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleScheduledJob],
      error: null,
    });

    const { result } = renderHook(() => useAiScheduledJobs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("daily_health_insights");
    expect(result.current.data?.[0].cron_expression).toBe("0 8 * * *");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_ai_scheduled_jobs_admin");
  });
});

describe("useCreateAiScheduledJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call create RPC with correct parameters", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: "new-job-uuid",
      error: null,
    });

    const { result } = renderHook(() => useCreateAiScheduledJob(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      name: "weekly_summary",
      display_name: "Weekly Summary",
      cron_expression: "0 10 * * 1",
      job_type: "ai_analysis",
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "create_ai_scheduled_job_admin",
      expect.objectContaining({
        p_name: "weekly_summary",
        p_display_name: "Weekly Summary",
        p_cron_expression: "0 10 * * 1",
        p_job_type: "ai_analysis",
      }),
    );
  });
});
