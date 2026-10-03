/**
 * Hook for auto-creating a Matrix room when a story is created or
 * when a participant is added to a story.
 *
 * Checks story_matrix_rooms for existing mapping. If none exists,
 * calls the `matrix-client-ops` edge function to provision a room on
 * the Synapse homeserver and stores the mapping.
 *
 * @module hooks/useStoryMatrixAutoMap
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { invokeEdgeFunction } from "@/integrations/api/edge";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { z } from "zod";

import { matrixKeys } from "@/hooks/useMatrixClient";

// =============================================================================
// Schemas
// =============================================================================

const createRoomResponseSchema = z.object({
  room_id: z.string(),
  room_alias: z.string().optional(),
});

const storyInfoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export interface StoryRoomMapping {
  storyId: string;
  matrixRoomId: string;
  isNew: boolean;
}

// =============================================================================
// Keys
// =============================================================================

const autoMapKeys = {
  mapping: (storyId: string) => ["story-matrix-map", storyId] as const,
};

// =============================================================================
// Hook
// =============================================================================

export function useStoryMatrixAutoMap(userId: string | undefined) {
  const queryClient = useQueryClient();

  // ─── Check existing mapping for a story ────────────────────
  const useStoryMapping = (storyId: string | null) =>
    useQuery({
      queryKey: autoMapKeys.mapping(storyId ?? ""),
      queryFn: async () => {
        const { data, error } = await aisha
          .rpc("get_story_general_matrix_room", { p_story_id: storyId! });

        if (error) {
          safeError("storyMatrixAutoMap.checkMapping", error);
          return null;
        }
        return data?.[0] ?? null;
      },
      enabled: !!storyId && !!userId,
      staleTime: 5 * 60 * 1000,
    });

  // ─── Ensure room exists (create if missing) ────────────────
  const ensureRoom = useMutation({
    mutationFn: async (storyId: string): Promise<StoryRoomMapping> => {
      if (!userId) throw new Error("Not authenticated");

      // 1. Check existing mapping via RPC
      const { data: existingRows } = await aisha
        .rpc("get_story_general_matrix_room", { p_story_id: storyId });
      const existing = existingRows?.[0];

      if (existing?.matrix_room_id) {
        return { storyId, matrixRoomId: existing.matrix_room_id, isNew: false };
      }

      // 2. Fetch story title for room name via RPC
      const { data: storyRows } = await aisha
        .rpc("get_story_basic_info", { p_story_id: storyId });
      const story = storyRows?.[0];

      const roomName = story?.title
        ? `Story: ${story.title}`
        : `Story ${storyId.slice(0, 8)}`;

      // 3. Create Matrix room via edge function
      const result = await invokeEdgeFunction({
        functionName: "matrix-client-ops",
        body: {
          action: "create_room",
          name: roomName,
          topic: `Discussion room for story ${storyId}`,
          is_direct: false,
        },
        schema: createRoomResponseSchema,
        context: "storyMatrixAutoMap.createRoom",
      });

      // 4. Store mapping via RPC
      const { error: insertError } = await aisha.rpc("create_story_matrix_room", {
        p_display_name: roomName,
        p_matrix_room_id: result.room_id,
        p_room_type: "general",
        p_story_id: storyId,
      });

      if (insertError) {
        safeError("storyMatrixAutoMap.insertMapping", insertError);
        throw new Error(insertError.message);
      }

      safeInfo("storyMatrixAutoMap.roomCreated", {
        storyId,
        matrixRoomId: result.room_id,
      });

      return { storyId, matrixRoomId: result.room_id, isNew: true };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: autoMapKeys.mapping(data.storyId),
      });
      queryClient.invalidateQueries({
        queryKey: matrixKeys.rooms(userId ?? ""),
      });
    },
    onError: (error) => {
      safeError("storyMatrixAutoMap.ensureRoom", error);
    },
  });

  // ─── Invite participant to story room ──────────────────────
  const inviteToRoom = useMutation({
    mutationFn: async ({
      storyId,
      matrixUserId,
    }: {
      storyId: string;
      matrixUserId: string;
    }) => {
      // Get room ID for story via RPC
      const { data: mappingRows, error } = await aisha
        .rpc("get_story_general_matrix_room", { p_story_id: storyId });
      const mapping = mappingRows?.[0];

      if (error || !mapping) {
        throw new Error("No Matrix room mapped for this story");
      }

      await invokeEdgeFunction({
        functionName: "matrix-client-ops",
        body: {
          action: "invite",
          room_id: mapping.matrix_room_id,
          user_id: matrixUserId,
        },
        schema: z.object({ success: z.boolean() }),
        context: "storyMatrixAutoMap.invite",
      });
    },
    onError: (error) => {
      safeError("storyMatrixAutoMap.invite", error);
    },
  });

  return {
    useStoryMapping,
    ensureRoom,
    inviteToRoom,
    isCreating: ensureRoom.isPending,
  };
}
