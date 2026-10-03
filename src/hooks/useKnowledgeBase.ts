import { useQuery, useMutation, useQueryClient, queryOptions, keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { z } from "zod";
import {
    knowledgeTopicSchema,
    knowledgeTopicDetailSchema,
    knowledgePostSchema,
    createKnowledgePostSchema,
    createKnowledgeTopicSchema,
    updateKnowledgeTopicSchema,
    deleteKnowledgeTopicSchema,
    moderationQueueItemSchema,
    reviewModerationItemSchema,
    type CreateKnowledgePostParams,
    type CreateKnowledgeTopicParams,
    type UpdateKnowledgeTopicParams,
    type DeleteKnowledgeTopicParams,
    type ModerationQueueItem,
    type ReviewModerationItemParams,
    knowledgeTopicArraySchema,
    knowledgePostArraySchema,
    type KnowledgeTopicRow,
    type KnowledgeTopicDetailRow,
    type KnowledgePostRow,
} from "@/lib/schemas/knowledgeBaseSchemas";

// =============================================================================
// Types
// =============================================================================

interface UseKnowledgeTopicsOptions {
    locale: string;
    visibility?: "public" | "members" | "archived"; // optional filter
    search?: string;
    limit?: number;
    offset?: number;
}

// =============================================================================
// Query Keys
// =============================================================================

export const knowledgeKeys = {
    all: ["knowledge"] as const,
    list: (opts: UseKnowledgeTopicsOptions) => ["knowledge", "list", opts] as const,
    detail: (slug: string) => ["knowledge", "detail", slug] as const,
    posts: (topicId: string) => ["knowledge", "posts", topicId] as const,
};

// =============================================================================
// Query Options (for prefetching in loaders)
// =============================================================================

/**
 * Query options for fetching knowledge topics list.
 * Used in route loaders for prefetching.
 */
export const knowledgeTopicsQueryOptions = (opts: Omit<UseKnowledgeTopicsOptions, "limit" | "offset"> & { limit?: number; offset?: number }) =>
    queryOptions({
        queryKey: knowledgeKeys.list({ locale: opts.locale, visibility: opts.visibility, search: opts.search, limit: opts.limit, offset: opts.offset }),
        queryFn: async () => {
            const { data, error } = await aisha.rpc("get_knowledge_topics_localized", {
                p_limit: opts.limit || 50,
                p_locale: opts.locale,
                p_offset: opts.offset || 0,
                p_search: opts.search || undefined,
                p_visibility: opts.visibility || undefined,
            });

            if (error) throw new Error(error.message);
            return z.array(knowledgeTopicSchema).parse(data);
        },
        staleTime: 2 * 60 * 1000, // 2 minutes
    });

/**
 * Query options for fetching a single knowledge topic detail.
 * Used in route loaders for prefetching.
 */
export const knowledgeTopicDetailQueryOptions = (slug: string, locale: string) =>
    queryOptions({
        queryKey: knowledgeKeys.detail(slug),
        queryFn: async () => {
            const { data, error } = await aisha.rpc("get_knowledge_topic_detail_localized", {
                p_locale: locale,
                p_slug: slug,
            });

            if (error) throw new Error(error.message);
            if (!data) return null;
            return knowledgeTopicDetailSchema.parse(data);
        },
        staleTime: 2 * 60 * 1000, // 2 minutes
    });

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetches a list of knowledge topics with localization and filtering.
 */
export const useKnowledgeTopics = (options: UseKnowledgeTopicsOptions) => {
    return useQuery({
        ...knowledgeTopicsQueryOptions(options),
        placeholderData: keepPreviousData,
    });
};

/**
 * Fetches a single knowledge topic detail by slug.
 */
export const useKnowledgeTopic = (slug: string, locale: string) => {
    return useQuery({
        ...knowledgeTopicDetailQueryOptions(slug, locale),
        enabled: !!slug,
    });
};

/**
 * Fetches posts for a topic with cursor-based pagination.
 * Uses `p_cursor` (timestamptz) for efficient keyset pagination.
 */
export const useKnowledgeTopicPosts = (topicId: string, locale: string = 'en', limit: number = 20) => {
    return useInfiniteQuery({
        queryKey: knowledgeKeys.posts(topicId),
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => {
            const { data, error } = await aisha.rpc("get_knowledge_topic_posts_localized", {
                p_cursor: pageParam ?? undefined,
                p_limit: limit,
                p_locale: locale,
                p_topic_id: topicId,
            });

            if (error) throw new Error(error.message);

            const posts = z.array(knowledgePostSchema).parse(data);
            const lastPost = posts.length > 0 ? posts[posts.length - 1] : null;
            return {
                posts,
                nextCursor: posts.length === limit && lastPost ? lastPost.created_at : null,
            };
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !!topicId,
    });
};


/**
 * Hook to create a new post (comment).
 */
export const useCreateKnowledgePost = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: CreateKnowledgePostParams) => {
            // Validate params against schema
            const validated = createKnowledgePostSchema.parse(params);

            const { data, error } = await aisha.rpc("create_knowledge_post_audited", {
                p_body: validated.body,
                p_topic_id: validated.topic_id,
            });

            if (error) throw new Error(error.message);
            return data;
        },
        onSuccess: (_, variables) => {
            // Invalidate posts for this topic to refetch
            queryClient.invalidateQueries({ queryKey: knowledgeKeys.posts(variables.topic_id) });
            // Also invalidate topic detail to update post count
            // We need the slug, but we only have topic_id here. 
            // Better to invalidate all details or accept that post count updates on next revisit.
            // Or we store the slug in the query key?
            queryClient.invalidateQueries({ queryKey: knowledgeKeys.all }); // Brute force refresh for MVP
        },
    });
};

export const useCreateKnowledgeTopic = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: CreateKnowledgeTopicParams) => {
            // Validate inputs
            const validated = createKnowledgeTopicSchema.parse(params);

            const { data, error } = await aisha.rpc("create_knowledge_topic", {
                p_initial_body: validated.initial_body,
                p_initial_locale: validated.initial_locale,
                p_initial_summary: validated.initial_summary,
                p_initial_title: validated.initial_title,
                p_slug: validated.slug,
                p_summary_key: validated.summary_key ?? undefined,
                p_title_key: validated.title_key,
                p_visibility: validated.visibility,
            });

            if (error) throw new Error(error.message);
            return data as string; // Returns topic_id
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
        },
    });
};

export const useUpdateKnowledgeTopic = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: UpdateKnowledgeTopicParams) => {
            const validated = updateKnowledgeTopicSchema.parse(params);

            const { data, error } = await aisha.rpc("update_knowledge_topic", {
                p_body: validated.body,
                p_commit_message: validated.commit_message,
                p_locale: validated.locale,
                p_slug: validated.slug,
                p_summary: validated.summary,
                p_summary_key: validated.summary_key,
                p_title: validated.title,
                p_title_key: validated.title_key,
                p_topic_id: validated.topic_id,
                p_visibility: validated.visibility,
            });

            if (error) throw new Error(error.message);
            return data; // Returns version_id
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
            queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(variables.slug || "") }); // Strategy: invalidating by slug requires slug logic
            // Ideally we invalidate just 'detail' family, or specific if we know
        },
    });
};

export const useDeleteKnowledgeTopic = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: DeleteKnowledgeTopicParams) => {
            const validated = deleteKnowledgeTopicSchema.parse(params);

            const { error } = await aisha.rpc("delete_knowledge_topic", {
                p_topic_id: validated.topic_id
            });

            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
        },
    });
};

export const useModerationQueue = (status: string = "pending") => {
    return useQuery({
        queryKey: ["knowledge", "moderation", status],
        queryFn: async () => {
            const { data, error } = await aisha.rpc("get_moderation_queue", {
                p_status: status
            });
            if (error) throw new Error(error.message);
            // Validate array
            return z.array(moderationQueueItemSchema).parse(data);
        },
    });
};

export const useReviewModerationItem = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: ReviewModerationItemParams) => {
            const { error } = await aisha.rpc("review_moderation_item", {
                p_decision: params.decision,
                p_notes: params.notes ?? undefined,
                p_queue_id: params.queue_id,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["knowledge", "moderation"] });
            // Also potentially invalidate posts? But we don't know the topic easily.
            // It's admin, so manual refresh is okay.
        },
    });
};
