/**
 * Mobile hook for Matrix message timeline within a specific room.
 *
 * Provides message fetching via the matrix-client-ops edge function
 * and Supabase Realtime for live updates when new messages arrive
 * via mautrix bridges.
 *
 * @module hooks/useMatrixMessages
 */

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, realtime } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

import { matrixKeys } from "@/hooks/useMatrixClient";

import type { RealtimeChannel } from "@aisha/api-core";

// =============================================================================
// Schemas
// =============================================================================

const matrixMessageSchema = z.object({
  event_id: z.string(),
  sender: z.string(),
  content: z.object({
    msgtype: z.string(),
    body: z.string(),
  }),
  origin_server_ts: z.number(),
  type: z.string(),
});

const messagesResponseSchema = z.object({
  messages: z.array(matrixMessageSchema),
  end: z.string().optional(),
});

// =============================================================================
// Types
// =============================================================================

export interface MatrixMessage {
  eventId: string;
  sender: string;
  body: string;
  msgtype: string;
  timestamp: number;
}

// =============================================================================
// Hook
// =============================================================================

export function useMatrixMessages(roomId: string | null, userId: string | undefined) {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ─── Query: message timeline ──────────────────────────────
  const messages = useQuery({
    queryKey: matrixKeys.messages(roomId ?? ""),
    queryFn: async () => {
      const { data, error } = await api.invoke("matrix-client-ops", {
        body: { action: "get_messages", room_id: roomId, limit: 50 },
      });

      if (error) throw error;

      const parsed = messagesResponseSchema.parse(data);

      return parsed.messages.map((m): MatrixMessage => ({
        eventId: m.event_id,
        sender: m.sender,
        body: m.content.body,
        msgtype: m.content.msgtype,
        timestamp: m.origin_server_ts,
      }));
    },
    enabled: !!roomId && !!userId,
    staleTime: 30_000,
  });

  // ─── Send a message ───────────────────────────────────────
  const sendMessage = useMutation({
    mutationFn: async (params: { body: string; msgtype?: string }) => {
      const { error } = await api.invoke("matrix-client-ops", {
        body: {
          action: "send_message",
          room_id: roomId,
          content: {
            msgtype: params.msgtype ?? "m.text",
            body: params.body,
          },
        },
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: matrixKeys.messages(roomId ?? "") });
    },
    onError: (error) => {
      safeError("matrixMessages.send", error);
    },
  });

  // ─── Realtime: listen for new messages via bridge events ──
  useEffect(() => {
    if (!roomId) return;

    if (channelRef.current) {
      realtime.removeChannel(channelRef.current);
    }

    const channel = realtime
      .channel(`matrix-messages-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "story_matrix_rooms",
          filter: `matrix_room_id=eq.${roomId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: matrixKeys.messages(roomId) });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      realtime.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, queryClient]);

  return {
    messages: messages.data ?? [],
    isLoading: messages.isLoading,
    sendMessage,
    isSending: sendMessage.isPending,
  };
}
