/**
 * Mobile hook for Matrix room list and room operations.
 *
 * Fetches rooms from story_matrix_rooms (Supabase) and provides
 * room metadata. When matrix-js-sdk is installed, this can be extended
 * to sync rooms directly from the Matrix homeserver.
 *
 * @module hooks/useMatrixRooms
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { safeError, safeWarn } from "@/lib/security/safeLogger";

import { matrixKeys } from "@/hooks/useMatrixClient";

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

export function useMatrixRooms(userId: string | undefined, storyId?: string | null) {
  const queryClient = useQueryClient();

  // ─── Query: rooms linked to user's stories ─────────────────
  const rooms = useQuery({
    queryKey: matrixKeys.rooms(userId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .rpc("get_story_matrix_rooms", { p_story_id: storyId ?? undefined });

      if (error) {
        safeWarn("matrixRooms.fetch", error);
        return [];
      }

      return (Array.isArray(data) ? data : []).map((r: unknown): MatrixRoom => {
        const row = r as { id: string; story_id: string; matrix_room_id: string; room_type: string; bridge_type: string | null; display_name: string | null; is_active: boolean; created_at: string };
        return {
          id: row.id,
          storyId: row.story_id,
          matrixRoomId: row.matrix_room_id,
          roomType: row.room_type as MatrixRoom["roomType"],
          bridgeType: row.bridge_type,
          displayName: row.display_name,
          isActive: row.is_active,
          createdAt: row.created_at,
        };
      });
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
      const { data, error } = await api.rpc("create_story_matrix_room", {
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
  const generalRooms = (rooms.data ?? []).filter((r: MatrixRoom) => r.roomType === "general");
  const bridgeRooms = (rooms.data ?? []).filter((r: MatrixRoom) => r.roomType === "bridge");
  const botRooms = (rooms.data ?? []).filter((r: MatrixRoom) => r.roomType === "bot");

  return {
    rooms: rooms.data ?? [],
    generalRooms,
    bridgeRooms,
    botRooms,
    isLoading: rooms.isLoading,
    createRoomMapping,
  };
}
