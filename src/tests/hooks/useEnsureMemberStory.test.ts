import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => hoisted.useSessionMock(),
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  safeError: vi.fn(),
}));

import { useEnsureMemberStory } from "@/hooks/useEnsureMemberStory";

/* ── Helpers ──────────────────────────────────────────────────── */

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

/* ── Tests ────────────────────────────────────────────────────── */

describe("useEnsureMemberStory", () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
  });

  it("should not query when user is null", async () => {
    hoisted.useSessionMock.mockReturnValue({
      user: null,
      hasRole: () => false,
    });

    const { result } = renderHook(() => useEnsureMemberStory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
    expect(result.current.storyId).toBeNull();
  });

  it("should not query when user is not a member", async () => {
    hoisted.useSessionMock.mockReturnValue({
      user: { id: "user-001" },
      hasRole: (role: string) => role !== "member",
    });

    const { result } = renderHook(() => useEnsureMemberStory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
    expect(result.current.storyId).toBeNull();
  });

  it("should return existing story ID for member", async () => {
    const storyId = "story-uuid-123";
    hoisted.useSessionMock.mockReturnValue({
      user: { id: "user-001" },
      hasRole: (role: string) => role === "member",
    });
    hoisted.rpcMock.mockResolvedValue({ data: storyId, error: null });

    const { result } = renderHook(() => useEnsureMemberStory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.storyId).toBe(storyId);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("ensure_member_story_exists");
  });

  it("should return null when no eligible registration (data is null)", async () => {
    hoisted.useSessionMock.mockReturnValue({
      user: { id: "user-002" },
      hasRole: (role: string) => role === "member",
    });
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useEnsureMemberStory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.storyId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("should handle RPC error", async () => {
    hoisted.useSessionMock.mockReturnValue({
      user: { id: "user-003" },
      hasRole: (role: string) => role === "member",
    });
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Function not found" },
    });

    const { result } = renderHook(() => useEnsureMemberStory(), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
      },
      { timeout: 5000 },
    );

    expect(result.current.storyId).toBeNull();
  });
});
