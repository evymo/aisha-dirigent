/**
 * Hooks for cross-story link management (AISHA Collaboration Network).
 *
 * Provides:
 * - useLinkedStories — fetch all linked stories for a given story
 * - useStoryGraph — traverse the story graph (recursive, max depth 3)
 * - useCrossStorySummary — sanitized summary of a linked story
 * - useCreateStoryLink — create a new link between two stories
 * - useAcceptStoryLink — accept a pending link
 * - useDismissStoryLink — dismiss (reject) a pending link
 *
 * @module hooks/useStoryLinks
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { safeError } from "@/lib/security/safeLogger";
import {
  linkedStoriesArraySchema,
  createStoryLinkResponseSchema,
  storyLinkActionResponseSchema,
  storyGraphArraySchema,
  crossStorySummarySchema,
} from "@/lib/schemas/collaborationSchemas";

import type {
  LinkedStory,
  CreateStoryLinkResponse,
  StoryLinkActionResponse,
  StoryGraphNode,
  CrossStorySummary,
} from "@/lib/schemas/collaborationSchemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const storyLinkKeys = {
  all: ["story-links"] as const,
  links: (storyId: string) =>
    [...storyLinkKeys.all, "links", storyId] as const,
  graph: (storyId: string, maxDepth: number) =>
    [...storyLinkKeys.all, "graph", storyId, maxDepth] as const,
  crossSummary: (requestingStoryId: string, targetStoryId: string) =>
    [...storyLinkKeys.all, "cross-summary", requestingStoryId, targetStoryId] as const,
};

// ---------------------------------------------------------------------------
// GET: Linked stories for a story
// ---------------------------------------------------------------------------

/**
 * Fetch all linked stories for a given story (bidirectional).
 *
 * Returns incoming and outgoing links with sanitized story metadata.
 */
export function useLinkedStories(storyId: string | undefined) {
  return useQuery<LinkedStory[]>({
    queryKey: storyLinkKeys.links(storyId ?? ""),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_linked_stories", {
        p_story_id: storyId!,
      });

      if (error) {
        safeError("storyLinks.getLinkedStories", error);
        throw new Error(error.message);
      }

      const parsed = linkedStoriesArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("storyLinks.getLinkedStories.validation", parsed.error.issues);
        return [];
      }

      return parsed.data;
    },
    enabled: !!storyId,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// GET: Story graph (recursive traversal)
// ---------------------------------------------------------------------------

/**
 * Traverse the story graph from a starting story.
 *
 * Returns connected stories up to maxDepth (capped at 3).
 * Only includes accepted links.
 */
export function useStoryGraph(storyId: string | undefined, maxDepth = 3) {
  return useQuery<StoryGraphNode[]>({
    queryKey: storyLinkKeys.graph(storyId ?? "", maxDepth),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_story_graph", {
        p_max_depth: maxDepth,
        p_story_id: storyId!,
      });

      if (error) {
        safeError("storyLinks.getStoryGraph", error);
        throw new Error(error.message);
      }

      const parsed = storyGraphArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("storyLinks.getStoryGraph.validation", parsed.error.issues);
        return [];
      }

      return parsed.data;
    },
    enabled: !!storyId,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// GET: Cross-story summary (sanitized)
// ---------------------------------------------------------------------------

/**
 * Fetch a sanitized summary of a linked story.
 *
 * Requires an accepted link between the requesting and target stories.
 * Returns only non-sensitive fields + recent public entries (max 200 chars).
 */
export function useCrossStorySummary(
  requestingStoryId: string | undefined,
  targetStoryId: string | undefined,
) {
  return useQuery<CrossStorySummary | null>({
    queryKey: storyLinkKeys.crossSummary(
      requestingStoryId ?? "",
      targetStoryId ?? "",
    ),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_cross_story_summary", {
        p_requesting_story_id: requestingStoryId!,
        p_target_story_id: targetStoryId!,
      });

      if (error) {
        safeError("storyLinks.getCrossStorySummary", error);
        throw new Error(error.message);
      }

      const parsed = crossStorySummarySchema.safeParse(data);
      if (!parsed.success) {
        safeError("storyLinks.getCrossStorySummary.validation", parsed.error.issues);
        return null;
      }

      return parsed.data;
    },
    enabled: !!requestingStoryId && !!targetStoryId,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// MUTATION: Create story link
// ---------------------------------------------------------------------------

interface CreateStoryLinkParams {
  sourceStoryId: string;
  targetStoryId: string;
  linkType: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new link between two stories.
 *
 * The caller must be a participant of the source story.
 * The link starts as pending (is_accepted = null) until the target side accepts.
 */
export function useCreateStoryLink() {
  const queryClient = useQueryClient();

  return useMutation<CreateStoryLinkResponse, Error, CreateStoryLinkParams>({
    mutationFn: async (params) => {
      const { data, error } = await aisha.rpc("create_story_link", {
        p_link_type: params.linkType,
        p_metadata: (params.metadata ?? {}) as Json,
        p_source_story_id: params.sourceStoryId,
        p_target_story_id: params.targetStoryId,
      });

      if (error) {
        safeError("storyLinks.createStoryLink", error);
        throw new Error(error.message);
      }

      const parsed = createStoryLinkResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("storyLinks.createStoryLink.validation", parsed.error.issues);
        throw new Error("Invalid create link response");
      }

      return parsed.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: storyLinkKeys.links(variables.sourceStoryId),
      });
      queryClient.invalidateQueries({
        queryKey: storyLinkKeys.links(variables.targetStoryId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// MUTATION: Accept story link
// ---------------------------------------------------------------------------

/**
 * Accept a pending story link.
 *
 * Caller must be a participant of the target story or an admin/staff.
 */
export function useAcceptStoryLink() {
  const queryClient = useQueryClient();

  return useMutation<StoryLinkActionResponse, Error, { linkId: string; storyId: string }>({
    mutationFn: async (params) => {
      const { data, error } = await aisha.rpc("accept_story_link", {
        p_link_id: params.linkId,
      });

      if (error) {
        safeError("storyLinks.acceptStoryLink", error);
        throw new Error(error.message);
      }

      const parsed = storyLinkActionResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("storyLinks.acceptStoryLink.validation", parsed.error.issues);
        throw new Error("Invalid accept link response");
      }

      return parsed.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: storyLinkKeys.links(variables.storyId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// MUTATION: Dismiss story link
// ---------------------------------------------------------------------------

/**
 * Dismiss (reject) a pending story link.
 *
 * Caller must be a participant of either linked story or an admin/staff.
 */
export function useDismissStoryLink() {
  const queryClient = useQueryClient();

  return useMutation<StoryLinkActionResponse, Error, { linkId: string; storyId: string }>({
    mutationFn: async (params) => {
      const { data, error } = await aisha.rpc("dismiss_story_link", {
        p_link_id: params.linkId,
      });

      if (error) {
        safeError("storyLinks.dismissStoryLink", error);
        throw new Error(error.message);
      }

      const parsed = storyLinkActionResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("storyLinks.dismissStoryLink.validation", parsed.error.issues);
        throw new Error("Invalid dismiss link response");
      }

      return parsed.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: storyLinkKeys.links(variables.storyId),
      });
    },
  });
}
