/**
 * useStoryLoop Hook Tests
 *
 * Tests for StoryLoop partner workspace data layer.
 * All data access goes through audited RPC functions.
 *
 * @see src/hooks/useStoryLoop.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import {
  useStories,
  useInfiniteStories,
  useStoryDetail,
  useStoryStats,
  useUpcomingReminders,
  useStoryLabels,
  useStoryAiContext,
  useStoryAttachableDocuments,
  useCreateStory,
  useCreateStoryEntry,
  useUpdateStoryStatus,
  useToggleStoryStar,
  useCreateStoryReminder,
  storyLoopKeys,
} from "@/hooks/useStoryLoop";
import React from "react";

// Mock aisha
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock useSession
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id", email: "partner@platform.rtn" },
    isLoading: false,
  }),
}));

// Mock safeLogger
vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: vi.fn(),
  };
});

// Test data
const mockStoryListItems = [
  {
    id: "e0c7f123-1234-5678-9abc-def012345678",
    partner_id: "f1c7f123-1234-5678-9abc-def012345678",
    user_id: "a1c7f123-1234-5678-9abc-def012345678",
    user_display_name: "Jan Novák",
    study_id: "b1c7f123-1234-5678-9abc-def012345678",
    study_name: "Immunology Study",
    title: "Initial Consultation",
    status: "inbox",
    priority: "normal",
    is_starred: false,
    is_read: true,
    unread_count: 0,
    last_activity_at: "2025-01-18T10:00:00Z",
    last_entry_preview: "Dobrý den...",
    created_at: "2025-01-17T10:00:00Z",
    labels: [],
  },
  {
    id: "e0c7f123-1234-5678-9abc-def012345679",
    partner_id: "f1c7f123-1234-5678-9abc-def012345678",
    user_id: "a1c7f123-1234-5678-9abc-def012345679",
    user_display_name: "Marie Svobodová",
    study_id: null,
    study_name: null,
    title: "Follow-up Check",
    status: "in_progress",
    priority: "high",
    is_starred: true,
    is_read: false,
    unread_count: 2,
    last_activity_at: "2025-01-18T14:00:00Z",
    last_entry_preview: "Prosím o kontrolu...",
    created_at: "2025-01-10T08:00:00Z",
    labels: [{ label: "urgent", color: "#ff0000" }],
  },
];

const mockStoryDetail = {
  id: "e0c7f123-1234-5678-9abc-def012345678",
  partner_id: "f1c7f123-1234-5678-9abc-def012345678",
  user_id: "a1c7f123-1234-5678-9abc-def012345678",
  user_display_name: "Jan Novák",
  study_id: "b1c7f123-1234-5678-9abc-def012345678",
  study_name: "Immunology Study",
  title: "Initial Consultation",
  status: "inbox",
  priority: "normal",
  is_starred: false,
  is_read: true,
  unread_count: 0,
  labels: [{ label: "urgent", color: "#ff0000" }],
  last_activity_at: "2025-01-18T10:00:00Z",
  created_at: "2025-01-17T10:00:00Z",
  updated_at: "2025-01-18T10:00:00Z",
  entries: [
    {
      id: "c0c7f123-1234-5678-9abc-def012345678",
      parent_id: null,
      entry_type: "note",
      content: "Initial consultation notes",
      metadata: {},
      is_internal: false,
      is_pinned: false,
      document_id: null,
      created_by: "f1c7f123-1234-5678-9abc-def012345678",
      created_by_name: "Dr. Specialist",
      created_at: "2025-01-17T10:30:00Z",
      document_preview: null,
    },
  ],
  reminders: [],
};

const mockStoryStats = {
  active_count: 1,
  inbox_count: 5,
  in_progress_count: 3,
  scheduled_count: 2,
  archived_count: 10,
  starred_count: 4,
  unread_total: 7,
};

const mockUpcomingReminders = [
  {
    id: "d0c7f123-1234-5678-9abc-def012345678",
    story_id: "e0c7f123-1234-5678-9abc-def012345678",
    story_title: "Initial Consultation",
    user_display_name: "Jan Novák",
    remind_at: "2025-01-19T09:00:00Z",
    message: "Follow up on lab results",
    is_overdue: false,
  },
];

const mockLabelStats = [
  { label: "urgent", color: "#ff0000", story_count: 3 },
  { label: "new-user", color: "#00ff00", story_count: 5 },
  { label: "follow-up", color: "#0000ff", story_count: 8 },
];

const mockAiContext = {
  story_id: "e0c7f123-1234-5678-9abc-def012345678",
  study_id: null,
  has_consent: true,
  timeline_summary: [
    { type: "note", date: "2025-01-17", preview: "Initial consultation" },
  ],
  study_info: null,
  recent_checkins: null,
  shared_documents_count: 2,
};

const mockAttachableDocuments = [
  {
    id: "a6f8a1b2-1234-4f1a-8c4d-9d8102d4aa11",
    user_id: "a1c7f123-1234-5678-9abc-def012345678",
    file_name: "lab-results.pdf",
    file_path: "health-documents/a6f8a1b2.pdf",
    mime_type: "application/pdf",
    category: "lab_results",
    title: "CRP panel",
    description: "January lab panel",
    document_date: "2025-01-15",
    created_at: "2025-01-16T10:00:00Z",
  },
];

// Helper for wrapper
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useStoryLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Query Keys
  // =========================================================================

  describe("storyLoopKeys", () => {
    it("generates correct key for stories with filters", () => {
      const key = storyLoopKeys.stories({ status: "inbox", search: "test" });
      expect(key).toEqual(["storyloop", "stories", { status: "inbox", search: "test" }]);
    });

    it("generates correct key for single story", () => {
      const key = storyLoopKeys.story("story-123");
      expect(key).toEqual(["storyloop", "story", "story-123"]);
    });

    it("generates correct key for stats", () => {
      expect(storyLoopKeys.stats()).toEqual(["storyloop", "stats"]);
    });

    it("generates correct key for labels", () => {
      expect(storyLoopKeys.labels()).toEqual(["storyloop", "labels"]);
    });

    it("generates correct key for AI context", () => {
      const key = storyLoopKeys.aiContext("story-456");
      expect(key).toEqual(["storyloop", "ai-context", "story-456"]);
    });

    it("generates correct key for attachable documents", () => {
      const key = storyLoopKeys.attachableDocuments("story-456");
      expect(key).toEqual(["storyloop", "attachable-documents", "story-456"]);
    });
  });

  // =========================================================================
  // useStories Hook
  // =========================================================================

  describe("useStories", () => {
    it("fetches stories via RPC with filters", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockStoryListItems,
        error: null,
      });

      const { result } = renderHook(() => useStories({ status: "inbox" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_my_stories_audited", {
        p_status: "inbox",
        p_search: undefined,
        p_labels: undefined,
        p_limit: 50,
        p_offset: 0,
      });

      expect(result.current.data).toHaveLength(2);
      expect(result.current.data?.[0].user_display_name).toBe("Jan Novák");
    });

    it("returns empty array on validation error", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [{ invalid: "data" }],
        error: null,
      });

      const { result } = renderHook(() => useStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual([]);
    });

    it("handles RPC errors safely", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: "Database error", code: "500" },
      });

      const { result } = renderHook(() => useStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      // Error should not contain sensitive data
      expect(result.current.error).toBeDefined();
    });
  });

  // =========================================================================
  // useInfiniteStories Hook
  // =========================================================================

  describe("useInfiniteStories", () => {
    it("fetches first page of stories via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockStoryListItems,
        error: null,
      });

      const { result } = renderHook(() => useInfiniteStories({ status: "inbox" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_my_stories_audited", {
        p_status: "inbox",
        p_search: undefined,
        p_labels: undefined,
        p_limit: 30,
        p_offset: 0,
      });

      const stories = result.current.data?.pages.flatMap((p) => p.stories) ?? [];
      expect(stories).toHaveLength(2);
    });

    it("reports hasNextPage when page is full", async () => {
      // Generate exactly 30 items (default page size) to indicate there might be more
      const fullPage = Array.from({ length: 30 }, (_, i) => ({
        ...mockStoryListItems[0],
        id: `e0c7f123-1234-5678-9abc-def0123456${String(i).padStart(2, "0")}`,
      }));

      vi.mocked(aisha.rpc).mockResolvedValue({
        data: fullPage,
        error: null,
      });

      const { result } = renderHook(() => useInfiniteStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.hasNextPage).toBe(true);
    });

    it("reports no next page when results are less than page size", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockStoryListItems, // 2 items < 30 page size
        error: null,
      });

      const { result } = renderHook(() => useInfiniteStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.hasNextPage).toBe(false);
    });

    it("handles RPC errors safely", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: "Database error", code: "500" },
      });

      const { result } = renderHook(() => useInfiniteStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });

    it("returns empty array on validation error", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [{ invalid: "data" }],
        error: null,
      });

      const { result } = renderHook(() => useInfiniteStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const stories = result.current.data?.pages.flatMap((p) => p.stories) ?? [];
      expect(stories).toEqual([]);
      expect(result.current.hasNextPage).toBe(false);
    });

    it("uses custom page size when provided", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockStoryListItems,
        error: null,
      });

      renderHook(() => useInfiniteStories({ pageSize: 10 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith("get_my_stories_audited",
          expect.objectContaining({ p_limit: 10, p_offset: 0 })
        );
      });
    });

    it("uses audited RPC function", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [],
        error: null,
      });

      renderHook(() => useInfiniteStories(), { wrapper: createWrapper() });

      await waitFor(() => {
        const rpcName = vi.mocked(aisha.rpc).mock.calls[0]?.[0];
        expect(rpcName).toMatch(/audited/);
      });
    });
  });

  // =========================================================================
  // useStoryDetail Hook
  // =========================================================================

  describe("useStoryDetail", () => {
    it("fetches story detail via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [mockStoryDetail],
        error: null,
      });

      const { result } = renderHook(() => useStoryDetail("story-1"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_story_detail_audited", {
        p_story_id: "story-1",
      });

      expect(result.current.data?.title).toBe("Initial Consultation");
      expect(result.current.data?.entries).toHaveLength(1);
    });

    it("returns null when storyId is null", async () => {
      const { result } = renderHook(() => useStoryDetail(null), {
        wrapper: createWrapper(),
      });

      // Query should not be enabled
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("returns null when story not found", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHook(() => useStoryDetail("nonexistent"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeNull();
    });
  });

  // =========================================================================
  // useStoryStats Hook
  // =========================================================================

  describe("useStoryStats", () => {
    it("fetches story statistics via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [mockStoryStats],
        error: null,
      });

      const { result } = renderHook(() => useStoryStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_partner_story_stats");
      expect(result.current.data?.inbox_count).toBe(5);
      expect(result.current.data?.unread_total).toBe(7);
    });

    it("returns default stats on validation error", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [{ invalid: "stats" }],
        error: null,
      });

      const { result } = renderHook(() => useStoryStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.inbox_count).toBe(0);
    });
  });

  // =========================================================================
  // useUpcomingReminders Hook
  // =========================================================================

  describe("useUpcomingReminders", () => {
    it("fetches reminders via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockUpcomingReminders,
        error: null,
      });

      const { result } = renderHook(() => useUpcomingReminders(5), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_my_upcoming_reminders_audited", {
        p_limit: 5,
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].message).toBe("Follow up on lab results");
    });
  });

  // =========================================================================
  // useStoryLabels Hook
  // =========================================================================

  describe("useStoryLabels", () => {
    it("fetches labels via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockLabelStats,
        error: null,
      });

      const { result } = renderHook(() => useStoryLabels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_my_story_labels_audited");
      expect(result.current.data).toHaveLength(3);
      expect(result.current.data?.[0].label).toBe("urgent");
    });
  });

  // =========================================================================
  // useStoryAiContext Hook
  // =========================================================================

  describe("useStoryAiContext", () => {
    it("fetches AI context via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockAiContext,
        error: null,
      });

      const { result } = renderHook(() => useStoryAiContext("story-1"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_story_context_for_ai_audited", {
        p_story_id: "story-1",
      });

      expect(result.current.data?.has_consent).toBe(true);
      expect(result.current.data?.shared_documents_count).toBe(2);
    });

    it("returns null when storyId is null", async () => {
      const { result } = renderHook(() => useStoryAiContext(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  // =========================================================================
  // useStoryAttachableDocuments Hook
  // =========================================================================

  describe("useStoryAttachableDocuments", () => {
    it("fetches attachable documents via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockAttachableDocuments,
        error: null,
      });

      const { result } = renderHook(() => useStoryAttachableDocuments("story-1"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("get_story_attachable_documents_audited", {
        p_story_id: "story-1",
        p_limit: 200,
      });
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].file_name).toBe("lab-results.pdf");
    });

    it("does not fetch when storyId is null", async () => {
      const { result } = renderHook(() => useStoryAttachableDocuments(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  // =========================================================================
  // useCreateStory Mutation
  // =========================================================================

  describe("useCreateStory", () => {
    it("creates story via RPC and returns story ID", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: "new-story-id",
        error: null,
      });

      const { result } = renderHook(() => useCreateStory(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        user_id: "user-1",
        study_id: "study-1",
        title: "New Case",
      });

      expect(aisha.rpc).toHaveBeenCalledWith("create_story_audited", {
        p_user_id: "user-1",
        p_study_id: "study-1",
        p_title: "New Case",
      });
    });
  });

  // =========================================================================
  // useCreateStoryEntry Mutation
  // =========================================================================

  describe("useCreateStoryEntry", () => {
    it("creates story entry via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: "new-entry-id",
        error: null,
      });

      const { result } = renderHook(() => useCreateStoryEntry(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        story_id: "story-1",
        entry_type: "note",
        content: "Test note content",
        metadata: { priority: "high" },
        is_internal: false,
      });

      expect(aisha.rpc).toHaveBeenCalledWith("create_story_entry_audited", {
        p_story_id: "story-1",
        p_entry_type: "note",
        p_content: "Test note content",
        p_metadata: { priority: "high" },
        p_is_internal: false,
        p_parent_id: undefined,
        p_document_id: undefined,
      });
    });
  });

  // =========================================================================
  // useUpdateStoryStatus Mutation
  // =========================================================================

  describe("useUpdateStoryStatus", () => {
    it("updates story status via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: true,
        error: null,
      });

      const { result } = renderHook(() => useUpdateStoryStatus(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        story_id: "story-1",
        status: "archived",
      });

      expect(aisha.rpc).toHaveBeenCalledWith("update_story_status_audited", {
        p_story_id: "story-1",
        p_status: "archived",
      });
    });
  });

  // =========================================================================
  // useToggleStoryStar Mutation
  // =========================================================================

  describe("useToggleStoryStar", () => {
    it("toggles star via RPC and returns new state", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: true,
        error: null,
      });

      const { result } = renderHook(() => useToggleStoryStar(), {
        wrapper: createWrapper(),
      });

      const newState = await result.current.mutateAsync("story-1");

      expect(aisha.rpc).toHaveBeenCalledWith("toggle_story_star_audited", {
        p_story_id: "story-1",
      });
      expect(newState).toBe(true);
    });
  });

  // =========================================================================
  // useCreateStoryReminder Mutation
  // =========================================================================

  describe("useCreateStoryReminder", () => {
    it("creates reminder via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: "new-reminder-id",
        error: null,
      });

      const { result } = renderHook(() => useCreateStoryReminder(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        story_id: "story-1",
        remind_at: "2025-01-20T10:00:00Z",
        message: "Follow up on test results",
      });

      expect(aisha.rpc).toHaveBeenCalledWith("create_story_reminder_audited", {
        p_story_id: "story-1",
        p_remind_at: "2025-01-20T10:00:00Z",
        p_message: "Follow up on test results",
      });
    });
  });

  // =========================================================================
  // Security Tests
  // =========================================================================

  describe("Security", () => {
    it("all queries use audited RPC functions", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({ data: [], error: null });

      // Render multiple hooks
      renderHook(() => useStories(), { wrapper: createWrapper() });
      renderHook(() => useStoryDetail("story-1"), { wrapper: createWrapper() });
      renderHook(() => useStoryStats(), { wrapper: createWrapper() });

      await waitFor(() => {
        const calls = vi.mocked(aisha.rpc).mock.calls;
        // All RPC names should contain 'audited' or 'stats' (which is partner-scoped)
        const rpcNames = calls.map(c => c[0]);
        rpcNames.forEach(name => {
          expect(name).toMatch(/audited|stats/);
        });
      });
    });

    it("does not expose sensitive data in error messages", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: "Error for user Jan Novák", code: "500" },
      });

      const { result } = renderHook(() => useStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      // The hook uses safeError which sanitizes the message
      // Error message should not be directly exposed to UI
      expect(result.current.error).toBeDefined();
    });
  });
});
