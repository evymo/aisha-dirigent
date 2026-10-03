import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useModerationSessions,
  useModerationDecisions,
  moderationAdminKeys,
} from "@/hooks/useModerationAdmin";

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

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: () => true,
  }),
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: vi.fn(),
}));

// ── Test wrapper ───────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ── Sample data ────────────────────────────────────────────────

const sampleSession = {
  id: "00000000-0000-0000-0000-000000000001",
  story_id: null,
  user_id: "00000000-0000-0000-0000-aaaaaaaaaaaa",
  session_type: "chat_flow",
  expertise_level: "intermediate",
  tech_stack: ["typescript", "react"],
  status: "completed",
  metadata: {},
  decision_count: 3,
  critical_count: 1,
  created_at: "2026-03-05T10:00:00Z",
  updated_at: "2026-03-05T10:05:00Z",
};

const sampleDecision = {
  id: "00000000-0000-0000-0000-000000000010",
  session_id: "00000000-0000-0000-0000-000000000001",
  decision_type: "quality_finding",
  severity: "warning",
  recommendation: "Consider extracting this into a separate utility",
  evidence: { line: 42, file: "src/hooks/useTest.ts" },
  accepted: null,
  created_at: "2026-03-05T10:01:00Z",
};

// ── Query key tests ────────────────────────────────────────────

describe("moderationAdminKeys", () => {
  it("should produce stable keys", () => {
    expect(moderationAdminKeys.all).toEqual(["moderation-admin"]);
    expect(moderationAdminKeys.sessions({ status: "active" })).toEqual([
      "moderation-admin",
      "sessions",
      { status: "active" },
    ]);
    expect(moderationAdminKeys.decisions("abc")).toEqual([
      "moderation-admin",
      "decisions",
      "abc",
    ]);
  });
});

// ── useModerationSessions tests ────────────────────────────────

describe("useModerationSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch paginated sessions from RPC", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleSession],
      error: null,
    });

    const { result } = renderHook(() => useModerationSessions({ limit: 20 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].session_type).toBe("chat_flow");
    expect(result.current.data?.[0].decision_count).toBe(3);
    expect(result.current.data?.[0].critical_count).toBe(1);

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "get_moderation_sessions_admin",
      expect.objectContaining({
        p_limit: 20,
        p_offset: 0,
      }),
    );
  });

  it("should pass status and session type filters", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () =>
        useModerationSessions({
          status: "active",
          sessionType: "pr_review",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "get_moderation_sessions_admin",
      expect.objectContaining({
        p_status: "active",
        p_session_type: "pr_review",
      }),
    );
  });

  it("should return empty array on RPC error and throw", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const { result } = renderHook(() => useModerationSessions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

// ── useModerationDecisions tests ───────────────────────────────

describe("useModerationDecisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch decisions for a session", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [sampleDecision],
      error: null,
    });

    const sessionId = "00000000-0000-0000-0000-000000000001";
    const { result } = renderHook(
      () => useModerationDecisions(sessionId),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].decision_type).toBe("quality_finding");
    expect(result.current.data?.[0].severity).toBe("warning");

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "get_moderation_decisions_admin",
      { p_session_id: sessionId },
    );
  });

  it("should not fetch when sessionId is undefined", async () => {
    const { result } = renderHook(
      () => useModerationDecisions(undefined),
      { wrapper: createWrapper() },
    );

    // Give a tick for any potential unexpected call
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.isFetching).toBe(false);
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });
});
