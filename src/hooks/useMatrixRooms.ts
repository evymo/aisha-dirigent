/**
 * Hook for Matrix room list and room operations.
 *
 * Fetches rooms from story_matrix_rooms (Supabase) and provides
 * room metadata. When matrix-js-sdk is installed, this can be extended
 * to sync rooms directly from the Matrix homeserver.
 *
 * @module hooks/useMatrixRooms
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";
import { z } from "zod";

import { matrixKeys } from "@/hooks/useMatrixClient";

// =============================================================================
// Schemas
// =============================================================================

const storyMatrixRoomSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  matrix_room_id: z.string(),
  room_type: z.enum(["general", "voice", "bridge", "bot"]),
  bridge_type: z.string().nullable(),
  display_name: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export interface MatrixRoom {
  id: string;
  storyId: string;
  matrixRoomId: string;
  roomType: "general" | "voice" | "bridge" | "bot";
  bridgeType: string | null;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
}

// =============================================================================
// Hook
// =============================================================================

export function useMatrixRooms(storyId?: string | null) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  // ─── Query: rooms linked to user's stories ─────────────────
  const rooms = useQuery({
    queryKey: matrixKeys.rooms(userId ?? ""),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_story_matrix_rooms", {
        p_story_id: storyId ?? undefined,
      });

      if (error) {
        safeWarn("matrixRooms.fetch", error);
        return [];
      }

      return (data ?? []).map((r): MatrixRoom => ({
        id: r.id,
        storyId: r.story_id,
        matrixRoomId: r.matrix_room_id,
        roomType: r.room_type as MatrixRoom["roomType"],
        bridgeType: r.bridge_type,
        displayName: r.display_name,
        isActive: r.is_active,
        createdAt: r.created_at,
      }));
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Create room mapping ──────────────────────────────────
  const createRoomMapping = useMutation({
    mutationFn: async (params: {
      storyId: string;
      matrixRoomId: string;
      roomType: MatrixRoom["roomType"];
      bridgeType?: string;
      displayName?: string;
    }) => {
      const { data, error } = await aisha.rpc("create_story_matrix_room", {
        p_bridge_type: params.bridgeType ?? undefined,
        p_display_name: params.displayName ?? undefined,
        p_matrix_room_id: params.matrixRoomId,
        p_room_type: params.roomType,
        p_story_id: params.storyId,
      });

      if (error) {
        safeError("matrixRooms.create", error);
        throw new Error(error.message);
      }

      return { id: data as string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: matrixKeys.rooms(userId ?? "") });
    },
  });

  // ─── Derived data ─────────────────────────────────────────
  const generalRooms = (rooms.data ?? []).filter((r) => r.roomType === "general");
  const bridgeRooms = (rooms.data ?? []).filter((r) => r.roomType === "bridge");
  const botRooms = (rooms.data ?? []).filter((r) => r.roomType === "bot");

  return {
    rooms: rooms.data ?? [],
    generalRooms,
    bridgeRooms,
    botRooms,
    isLoading: rooms.isLoading,
    createRoomMapping,
  };
}
