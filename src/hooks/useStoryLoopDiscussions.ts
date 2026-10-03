/**
 * StoryLoop Discussions Hook
 *
 * Integrates knowledge base topics as discussion threads
 * into the StoryLoop workspace. Knowledge topics appear
 * alongside partner case stories, with posts as "entries".
 *
 * @module hooks/useStoryLoopDiscussions
 */

import { getTranslationLocale } from "@/lib/i18n/locale";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  knowledgeTopicSchema,
  knowledgeTopicDetailSchema,
  knowledgePostSchema,
  type KnowledgeTopicRow,
  type KnowledgeTopicDetailRow,
  type KnowledgePostRow,
} from "@/lib/schemas/knowledgeBaseSchemas";
import { knowledgeKeys } from "./useKnowledgeBase";

// =============================================================================
// Types
// =============================================================================

/** A discussion thread in StoryLoop (backed by knowledge_topics). */
export interface DiscussionThread {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  visibility: string;
  verification_status: string;
  source_locale: string;
  is_locked: boolean;
  post_count: number;
  created_at: string;
  updated_at: string;
}

/** Discussion post (backed by knowledge_posts). */
export interface DiscussionPost {
  id: string;
  topic_id: string;
  author_display_name: string | null;
  body: string;
  original_locale: string;
  is_translated: boolean;
  translation_provider: string | null;
  status: string;
  created_at: string;
}

// =============================================================================
// Query Keys
// =============================================================================

export const discussionKeys = {
  all: ["storyloop", "discussions"] as const,
  list: (filters?: { search?: string; visibility?: string }) =>
    [...discussionKeys.all, "list", filters] as const,
  detail: (topicId: string) =>
    [...discussionKeys.all, "detail", topicId] as const,
  posts: (topicId: string) =>
    [...discussionKeys.all, "posts", topicId] as const,
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch discussion threads (knowledge topics) for StoryLoop sidebar.
 * Returns threads formatted for StoryLoop list display.
 */
export function useDiscussionThreads(filters?: {
  search?: string | null;
  visibility?: string | null;
}) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  return useQuery({
    queryKey: discussionKeys.list({
      search: filters?.search ?? undefined,
      visibility: filters?.visibility ?? undefined,
    }),
    queryFn: async (): Promise<DiscussionThread[]> => {
      const { data, error } = await aisha.rpc(
        "get_knowledge_topics_localized",
        {
          p_limit: 100,
          p_locale: locale,
          p_offset: 0,
          p_search: filters?.search ?? undefined,
          p_visibility: filters?.visibility ?? undefined,
        }
      );

      if (error) {
        safeError("storyloop.discussions.list", error);
        throw new Error(error.message);
      }

      const validated = z.array(knowledgeTopicSchema).safeParse(data);
      if (!validated.success) {
        safeError("storyloop.discussions.list.validation", validated.error);
        return [];
      }

      return validated.data;
    },
  });
}

/**
 * Fetch a single discussion thread detail (knowledge topic).
 */
export function useDiscussionThreadDetail(topicId: string | null) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  return useQuery({
    queryKey: discussionKeys.detail(topicId ?? ""),
    queryFn: async (): Promise<KnowledgeTopicDetailRow | null> => {
      if (!topicId) return null;

      // We need slug → use a lookup by id approach
      // First try to get the topic's slug from the list cache, otherwise fetch detail by id
      const { data, error } = await aisha.rpc(
        "get_knowledge_topic_detail_by_id_localized",
        {
          p_locale: locale,
          p_topic_id: topicId,
        }
      );

      if (error) {
        // Fallback: if the RPC doesn't exist yet, return null gracefully
        safeError("storyloop.discussions.detail", error);
        return null;
      }

      if (!data) return null;
      const validated = knowledgeTopicDetailSchema.safeParse(data);
      if (!validated.success) {
        safeError("storyloop.discussions.detail.validation", validated.error);
        return null;
      }

      return validated.data;
    },
    enabled: !!topicId,
  });
}

/**
 * Fetch discussion posts (knowledge posts) with cursor-based pagination.
 * Returns posts formatted like StoryLoop entries.
 */
export function useDiscussionPosts(
  topicId: string | null,
  limit: number = 30
) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  return useInfiniteQuery({
    queryKey: discussionKeys.posts(topicId ?? ""),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!topicId) return { posts: [], nextCursor: null };

      const { data, error } = await aisha.rpc(
        "get_knowledge_topic_posts_localized",
        {
          p_cursor: pageParam ?? undefined,
          p_limit: limit,
          p_locale: locale,
          p_topic_id: topicId,
        }
      );

      if (error) {
        safeError("storyloop.discussions.posts", error);
        throw new Error(error.message);
      }

      const posts = z.array(knowledgePostSchema).safeParse(data);
      if (!posts.success) {
        safeError("storyloop.discussions.posts.validation", posts.error);
        return { posts: [], nextCursor: null };
      }

      const lastPost =
        posts.data.length > 0 ? posts.data[posts.data.length - 1] : null;
      return {
        posts: posts.data,
        nextCursor:
          posts.data.length === limit && lastPost
            ? lastPost.created_at
            : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!topicId,
  });
}

/**
 * Create a new discussion post (knowledge post) from StoryLoop.
 */
export function useCreateDiscussionPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { body: string; topic_id: string }) => {
      if (!params.body.trim()) throw new Error("Post body is required");

      const { data, error } = await aisha.rpc(
        "create_knowledge_post_audited",
        {
          p_body: params.body,
          p_topic_id: params.topic_id,
        }
      );

      if (error) {
        safeError("storyloop.discussions.createPost", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: (_, variables) => {
      // Invalidate discussion posts for this topic
      queryClient.invalidateQueries({
        queryKey: discussionKeys.posts(variables.topic_id),
      });
      // Invalidate thread list to update post_count
      queryClient.invalidateQueries({
        queryKey: discussionKeys.list(),
      });
      // Also invalidate the global knowledge cache
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.all,
      });
    },
  });
}
