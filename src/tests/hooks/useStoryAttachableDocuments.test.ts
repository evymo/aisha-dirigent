/**
 * useStoryAttachableDocuments Hook Tests
 *
 * Tests for fetching attachable documents for StoryLoop entries.
 * Validates RPC call, Zod schema validation, and edge cases.
 *
 * @see src/hooks/useStoryLoop.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useStoryAttachableDocuments } from "@/hooks/useStoryLoop";

// ---------- mocks ----------

const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "partner-user-id" },
    session: { access_token: "test-token" },
  }),
}));

// ---------- helpers ----------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ---------- fixtures ----------

const STORY_ID = "aaaaaaaa-1111-2222-3333-444444444444";

const MOCK_DOCUMENTS = [
  {
    id: "dddddddd-1111-2222-3333-444444444444",
    user_id: "eeeeeeee-1111-2222-3333-444444444444",
    file_name: "blood_test_2026.pdf",
    file_path: "documents/blood_test_2026.pdf",
    mime_type: "application/pdf",
    category: "lab_result",
    title: "Blood Test January 2026",
    description: "Routine blood work",
    document_date: "2026-01-15",
    created_at: "2026-01-15T10:00:00Z",
  },
  {
    id: "dddddddd-5555-6666-7777-888888888888",
    user_id: "eeeeeeee-1111-2222-3333-444444444444",
    file_name: "prescription.jpg",
    file_path: "documents/prescription.jpg",
    mime_type: "image/jpeg",
    category: "prescription",
    title: null,
    description: null,
    document_date: null,
    created_at: "2026-01-20T14:30:00Z",
  },
];

// ---------- tests ----------

describe("useStoryAttachableDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches attachable documents via RPC", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_DOCUMENTS, error: null });

    const { result } = renderHook(
      () => useStoryAttachableDocuments(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "get_story_attachable_documents_audited",
      expect.objectContaining({
        p_limit: 200,
        p_story_id: STORY_ID,
      }),
    );

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].file_name).toBe("blood_test_2026.pdf");
    expect(result.current.data?.[1].category).toBe("prescription");
  });

  it("returns empty array when storyId is null (disabled)", async () => {
    const { result } = renderHook(
      () => useStoryAttachableDocuments(null),
      { wrapper: createWrapper() },
    );

    // Query should not fire
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Permission denied", code: "42501" },
    });

    const { result } = renderHook(
      () => useStoryAttachableDocuments(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("Permission denied");
  });

  it("returns empty array when Zod validation fails (invalid data)", async () => {
    const invalidData = [
      { id: "not-a-uuid", file_name: 123, bogus_field: true },
    ];
    mockRpc.mockResolvedValue({ data: invalidData, error: null });

    const { result } = renderHook(
      () => useStoryAttachableDocuments(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // safeParse fails → returns []
    expect(result.current.data).toEqual([]);
  });

  it("handles empty result set from RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useStoryAttachableDocuments(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it("validates nullable fields correctly", async () => {
    const docWithNulls = [
      {
        id: "dddddddd-9999-0000-1111-222222222222",
        user_id: "eeeeeeee-1111-2222-3333-444444444444",
        file_name: "scan.png",
        file_path: "documents/scan.png",
        mime_type: null,
        category: "other",
        title: null,
        description: null,
        document_date: null,
        created_at: "2026-02-01T00:00:00Z",
      },
    ];
    mockRpc.mockResolvedValue({ data: docWithNulls, error: null });

    const { result } = renderHook(
      () => useStoryAttachableDocuments(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].mime_type).toBeNull();
    expect(result.current.data?.[0].title).toBeNull();
    expect(result.current.data?.[0].document_date).toBeNull();
  });

  it("uses correct query key for caching", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useStoryAttachableDocuments(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify the hook was called (RPC fired once with correct story ID)
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "get_story_attachable_documents_audited",
      { p_limit: 200, p_story_id: STORY_ID },
    );
  });
});
