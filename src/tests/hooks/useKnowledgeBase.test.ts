import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  knowledgeKeys,
  knowledgeTopicDetailQueryOptions,
  knowledgeTopicsQueryOptions,
  useCreateKnowledgePost,
  useCreateKnowledgeTopic,
  useDeleteKnowledgeTopic,
  useKnowledgeTopic,
  useKnowledgeTopicPosts,
  useKnowledgeTopics,
  useModerationQueue,
  useReviewModerationItem,
  useUpdateKnowledgeTopic,
} from "@/hooks/useKnowledgeBase";
import { createTestQueryClient, renderHookWithProviders } from "@/tests/utils/test-utils";

const rpcMock = vi.hoisted(() => vi.fn());
const safeErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: rpcMock,
  },
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: safeErrorMock,
}));

vi.mock("@/lib/security/userFacingErrors", () => ({
  getUserFacingDataErrorMessage: vi.fn(() => "error"),
}));

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const QUEUE_ID = "33333333-3333-4333-8333-333333333333";

const topicRow = {
  id: TOPIC_ID,
  slug: "longevity",
  title: "Longevity",
  summary: "Evidence base",
  visibility: "public",
  verification_status: "verified",
  source_locale: "en",
  is_locked: false,
  post_count: 1,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-02T00:00:00.000Z",
};

const detailRow = {
  ...topicRow,
  body_markdown: "# Longevity",
  links: [],
};

const postRow = {
  id: POST_ID,
  topic_id: TOPIC_ID,
  author_display_name: "Aisha Member",
  body: "Evidence note",
  original_locale: "en",
  is_translated: false,
  translation_provider: null,
  status: "published",
  created_at: "2026-04-03T00:00:00.000Z",
};

describe("useKnowledgeBase", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    safeErrorMock.mockReset();
  });

  it("builds stable query keys and query options", async () => {
    expect(knowledgeKeys.list({ locale: "en", limit: 5 })).toEqual([
      "knowledge",
      "list",
      { locale: "en", limit: 5 },
    ]);

    rpcMock.mockResolvedValueOnce({ data: [topicRow], error: null });

    const queryClient = createTestQueryClient();
    const options = knowledgeTopicsQueryOptions({ locale: "en", limit: 5 });
    await expect(queryClient.fetchQuery(options)).resolves.toEqual([topicRow]);
    expect(rpcMock).toHaveBeenCalledWith("get_knowledge_topics_localized", {
      p_limit: 5,
      p_locale: "en",
      p_offset: 0,
      p_search: undefined,
      p_visibility: undefined,
    });

    rpcMock.mockResolvedValueOnce({ data: detailRow, error: null });
    await expect(
      queryClient.fetchQuery(knowledgeTopicDetailQueryOptions("longevity", "cs")),
    ).resolves.toEqual(detailRow);
  });

  it("fetches localized knowledge topics", async () => {
    rpcMock.mockResolvedValueOnce({ data: [topicRow], error: null });

    const { result } = renderHookWithProviders(() =>
      useKnowledgeTopics({ locale: "en", visibility: "public", search: "long", limit: 10, offset: 2 }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([topicRow]);
    expect(rpcMock).toHaveBeenCalledWith("get_knowledge_topics_localized", {
      p_limit: 10,
      p_locale: "en",
      p_offset: 2,
      p_search: "long",
      p_visibility: "public",
    });
  });

  it("fetches topic detail only when slug is present", async () => {
    rpcMock.mockResolvedValueOnce({ data: detailRow, error: null });

    const { result } = renderHookWithProviders(() => useKnowledgeTopic("longevity", "en"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(detailRow);

    const disabled = renderHookWithProviders(() => useKnowledgeTopic("", "en"));
    expect(disabled.result.current.fetchStatus).toBe("idle");
  });

  it("fetches topic posts with next cursor", async () => {
    rpcMock.mockResolvedValueOnce({ data: [postRow], error: null });

    const { result } = renderHookWithProviders(() => useKnowledgeTopicPosts(TOPIC_ID, "en", 1));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0]).toEqual({
      posts: [postRow],
      nextCursor: postRow.created_at,
    });
    expect(rpcMock).toHaveBeenCalledWith("get_knowledge_topic_posts_localized", {
      p_cursor: undefined,
      p_limit: 1,
      p_locale: "en",
      p_topic_id: TOPIC_ID,
    });
  });

  it("creates posts and invalidates knowledge queries", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    rpcMock.mockResolvedValueOnce({ data: POST_ID, error: null });

    const { result } = renderHookWithProviders(() => useCreateKnowledgePost(), { queryClient });

    await act(async () => {
      await result.current.mutateAsync({
        topic_id: TOPIC_ID,
        body: "New evidence note",
      });
    });

    expect(rpcMock).toHaveBeenCalledWith("create_knowledge_post_audited", {
      p_body: "New evidence note",
      p_topic_id: TOPIC_ID,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: knowledgeKeys.posts(TOPIC_ID) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: knowledgeKeys.all });
  });

  it("creates, updates and deletes knowledge topics", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: TOPIC_ID, error: null })
      .mockResolvedValueOnce({ data: "version-1", error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const createHook = renderHookWithProviders(() => useCreateKnowledgeTopic());
    await act(async () => {
      await createHook.result.current.mutateAsync({
        slug: "longevity",
        title_key: "knowledge.longevity.title",
        visibility: "public",
        initial_locale: "en",
        initial_title: "Longevity",
      });
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "create_knowledge_topic", {
      p_initial_body: undefined,
      p_initial_locale: "en",
      p_initial_summary: undefined,
      p_initial_title: "Longevity",
      p_slug: "longevity",
      p_summary_key: undefined,
      p_title_key: "knowledge.longevity.title",
      p_visibility: "public",
    });

    const updateHook = renderHookWithProviders(() => useUpdateKnowledgeTopic());
    await act(async () => {
      await updateHook.result.current.mutateAsync({
        topic_id: TOPIC_ID,
        locale: "en",
        slug: "longevity",
        title: "Updated",
      });
    });

    expect(rpcMock).toHaveBeenNthCalledWith(2, "update_knowledge_topic", {
      p_body: undefined,
      p_commit_message: undefined,
      p_locale: "en",
      p_slug: "longevity",
      p_summary: undefined,
      p_summary_key: undefined,
      p_title: "Updated",
      p_title_key: undefined,
      p_topic_id: TOPIC_ID,
      p_visibility: undefined,
    });

    const deleteHook = renderHookWithProviders(() => useDeleteKnowledgeTopic());
    await act(async () => {
      await deleteHook.result.current.mutateAsync({ topic_id: TOPIC_ID });
    });

    expect(rpcMock).toHaveBeenNthCalledWith(3, "delete_knowledge_topic", {
      p_topic_id: TOPIC_ID,
    });
  });

  it("fetches moderation queue and reviews items", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: [{
          id: QUEUE_ID,
          resource_type: "post",
          resource_id: POST_ID,
          risk_score: 0.1,
          risk_tags: ["low"],
          status: "pending",
          created_at: "2026-04-01T00:00:00.000Z",
          post_body: "Needs review",
          post_author_name: "Aisha Member",
          topic_title: "Longevity",
          topic_slug: "longevity",
          reviewer_notes: null,
          aisha_evaluation: null,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const queueHook = renderHookWithProviders(() => useModerationQueue("pending"));
    await waitFor(() => expect(queueHook.result.current.isSuccess).toBe(true));
    expect(queueHook.result.current.data?.[0].id).toBe(QUEUE_ID);

    const reviewHook = renderHookWithProviders(() => useReviewModerationItem());
    await act(async () => {
      await reviewHook.result.current.mutateAsync({
        queue_id: QUEUE_ID,
        decision: "approved",
        notes: "Reviewed",
      });
    });

    expect(rpcMock).toHaveBeenNthCalledWith(2, "review_moderation_item", {
      p_decision: "approved",
      p_notes: "Reviewed",
      p_queue_id: QUEUE_ID,
    });
  });

  it("surfaces RPC errors through query state", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Database unavailable" },
    });

    const { result } = renderHookWithProviders(() => useKnowledgeTopics({ locale: "en" }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("Database unavailable"));
  });
});
