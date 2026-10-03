/**
 * useCollaborationPreferences Hook Tests
 *
 * Tests for collaboration preferences hooks:
 * - useCollaborationPreferences (fetch merged preferences)
 * - useUpdateCollaborationPreferences (upsert mutation)
 *
 * @see src/hooks/useCollaborationPreferences.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useCollaborationPreferences,
  useUpdateCollaborationPreferences,
  collaborationPreferenceKeys,
} from "@/hooks/useCollaborationPreferences";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

/* ── Test data ────────────────────────────────────────────────── */

const STORY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const VALID_PREFERENCES = {
  collab_mode: "notify",
  notify_status_changes: true,
  notify_blockers: true,
  notify_architecture_decisions: true,
  notify_code_events: false,
  notify_participant_changes: false,
  notify_ai_suggestions: true,
  max_daily_cross_notifications: 10,
  min_severity: "medium",
  quiet_start: "22:00:00",
  quiet_end: "07:00:00",
  timezone: "Europe/Prague",
  autopilot_max_actions_per_day: 3,
  autopilot_allowed_actions: ["suggest_link", "create_thread", "notify_overlap"],
  autopilot_risk_ceiling: "low",
  is_default: true,
  story_id: null,
};

const UPDATE_RESPONSE = {
  id: "22222222-2222-2222-2222-222222222222",
  story_id: null,
  updated: true,
};

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/* ── Query key factory tests ─────────────────────────────────── */

describe("collaborationPreferenceKeys", () => {
  it("produces correct global key", () => {
    expect(collaborationPreferenceKeys.prefs()).toEqual([
      "collaboration-preferences",
      "global",
    ]);
  });

  it("produces correct story-scoped key", () => {
    expect(collaborationPreferenceKeys.prefs(STORY_ID)).toEqual([
      "collaboration-preferences",
      STORY_ID,
    ]);
  });
});

/* ── useCollaborationPreferences tests ───────────────────────── */

describe("useCollaborationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns preferences on successful RPC call (global)", async () => {
    mockRpc.mockResolvedValue({ data: VALID_PREFERENCES, error: null });

    const { result } = renderHook(() => useCollaborationPreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.collab_mode).toBe("notify");
    expect(result.current.data?.is_default).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("get_collaboration_preferences", {
      p_story_id: undefined,
    });
  });

  it("returns preferences with story override", async () => {
    const storyPrefs = {
      ...VALID_PREFERENCES,
      collab_mode: "interactive",
      is_default: false,
      story_id: STORY_ID,
    };
    mockRpc.mockResolvedValue({ data: storyPrefs, error: null });

    const { result } = renderHook(
      () => useCollaborationPreferences(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.collab_mode).toBe("interactive");
    expect(result.current.data?.story_id).toBe(STORY_ID);
    expect(mockRpc).toHaveBeenCalledWith("get_collaboration_preferences", {
      p_story_id: STORY_ID,
    });
  });

  it("returns null on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({ data: { invalid: true }, error: null });

    const { result } = renderHook(() => useCollaborationPreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mockSafeError).toHaveBeenCalledWith(
      "collabPreferences.get.validation",
      expect.anything(),
    );
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "unauthorized" },
    });

    const { result } = renderHook(() => useCollaborationPreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalledWith(
      "collabPreferences.get",
      expect.anything(),
    );
  });
});

/* ── useUpdateCollaborationPreferences tests ──────────────────── */

describe("useUpdateCollaborationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates global preferences", async () => {
    mockRpc.mockResolvedValue({ data: UPDATE_RESPONSE, error: null });

    const { result } = renderHook(
      () => useUpdateCollaborationPreferences(),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        preferences: { collab_mode: "autopilot" },
      });
    });

    await waitFor(() => {
      expect(result.current.data?.updated).toBe(true);
    });
    expect(mockRpc).toHaveBeenCalledWith("update_collaboration_preferences", {
      p_preferences: { collab_mode: "autopilot" },
      p_story_id: undefined,
    });
  });

  it("updates story-scoped preferences", async () => {
    const storyUpdateResponse = {
      ...UPDATE_RESPONSE,
      story_id: STORY_ID,
    };
    mockRpc.mockResolvedValue({ data: storyUpdateResponse, error: null });

    const { result } = renderHook(
      () => useUpdateCollaborationPreferences(),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        storyId: STORY_ID,
        preferences: {
          collab_mode: "silent",
          notify_code_events: true,
        },
      });
    });

    await waitFor(() => {
      expect(result.current.data?.story_id).toBe(STORY_ID);
    });
    expect(mockRpc).toHaveBeenCalledWith("update_collaboration_preferences", {
      p_preferences: {
        collab_mode: "silent",
        notify_code_events: true,
      },
      p_story_id: STORY_ID,
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "invalid collab_mode" },
    });

    const { result } = renderHook(
      () => useUpdateCollaborationPreferences(),
      { wrapper: createWrapper() },
    );

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          preferences: { collab_mode: "autopilot" },
        });
      }),
    ).rejects.toThrow("invalid collab_mode");
  });
});
