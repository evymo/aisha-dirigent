/**
 * Hook for managing collaboration notification preferences.
 *
 * Provides:
 * - useCollaborationPreferences — fetch merged preferences (global + per-story override)
 * - useUpdateCollaborationPreferences — upsert preferences (global or per-story)
 *
 * @module hooks/useCollaborationPreferences
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import type { Json } from "@/integrations/db/types";
import {
  collaborationPreferencesSchema,
  updatePreferencesResponseSchema,
} from "@/lib/schemas/collaborationSchemas";

import type {
  CollaborationPreferences,
  UpdatePreferencesResponse,
} from "@/lib/schemas/collaborationSchemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const collaborationPreferenceKeys = {
  all: ["collaboration-preferences"] as const,
  prefs: (storyId?: string) =>
    [...collaborationPreferenceKeys.all, storyId ?? "global"] as const,
};

// ---------------------------------------------------------------------------
// GET: Collaboration preferences (merged global + per-story)
// ---------------------------------------------------------------------------

/**
 * Fetch the user's collaboration preferences.
 *
 * If storyId is provided, returns per-story override merged over global defaults.
 * If no preferences exist, returns sensible defaults from the server.
 */
export function useCollaborationPreferences(storyId?: string) {
  return useQuery<CollaborationPreferences | null>({
    queryKey: collaborationPreferenceKeys.prefs(storyId),
    queryFn: async () => {
      const { data, error } = await aisha.rpc(
        "get_collaboration_preferences",
        {
          p_story_id: storyId ?? undefined,
        },
      );

      if (error) {
        safeError("collabPreferences.get", error);
        throw new Error(error.message);
      }

      const parsed = collaborationPreferencesSchema.safeParse(data);
      if (!parsed.success) {
        safeError("collabPreferences.get.validation", parsed.error.issues);
        return null;
      }

      return parsed.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// MUTATION: Update collaboration preferences
// ---------------------------------------------------------------------------

interface UpdateCollabPreferencesParams {
  storyId?: string;
  preferences: Partial<Omit<CollaborationPreferences, "is_default" | "story_id">>;
}

/**
 * Upsert collaboration preferences (global or per-story).
 *
 * Pass storyId to create/update a per-story override.
 * Omit storyId to update global defaults.
 */
export function useUpdateCollaborationPreferences() {
  const queryClient = useQueryClient();

  return useMutation<UpdatePreferencesResponse, Error, UpdateCollabPreferencesParams>({
    mutationFn: async (params) => {
      const { data, error } = await aisha.rpc(
        "update_collaboration_preferences",
        {
          p_preferences: params.preferences as unknown as Json,
          p_story_id: params.storyId ?? undefined,
        },
      );

      if (error) {
        safeError("collabPreferences.update", error);
        throw new Error(error.message);
      }

      const parsed = updatePreferencesResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("collabPreferences.update.validation", parsed.error.issues);
        throw new Error("Invalid preferences update response");
      }

      return parsed.data;
    },
    onSuccess: (_, variables) => {
      // Invalidate both global and story-specific caches
      queryClient.invalidateQueries({
        queryKey: collaborationPreferenceKeys.all,
      });
      if (variables.storyId) {
        queryClient.invalidateQueries({
          queryKey: collaborationPreferenceKeys.prefs(variables.storyId),
        });
      }
    },
  });
}
