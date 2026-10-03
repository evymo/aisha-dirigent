/**
 * Hook for Matrix message timeline within a specific room.
 *
 * Provides message fetching via the matrix-client-ops edge function
 * and Supabase Realtime for live updates when new messages arrive
 * via mautrix bridges.
 *
 * When matrix-js-sdk is installed, this can be replaced with
 * direct client.getRoom().timeline access.
 *
 * @module hooks/useMatrixMessages
 */

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { invokeEdgeFunction } from "@/integrations/api/edge";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";
import { z } from "zod";

import { matrixKeys } from "@/hooks/useMatrixClient";

import type { RealtimeChannel } from "@/integrations/api/realtime";

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

export function useMatrixMessages(roomId: string | null) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ─── Query: message timeline ──────────────────────────────
  const messages = useQuery({
    queryKey: matrixKeys.messages(roomId ?? ""),
    queryFn: async () => {
      const result = await invokeEdgeFunction({
        functionName: "matrix-client-ops",
        body: { action: "get_messages", room_id: roomId, limit: 50 },
        schema: messagesResponseSchema,
        context: "matrixMessages.fetch",
      });

      return result.messages.map((m): MatrixMessage => ({
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
      await invokeEdgeFunction({
        functionName: "matrix-client-ops",
        body: {
          action: "send_message",
          room_id: roomId,
          content: {
            msgtype: params.msgtype ?? "m.text",
            body: params.body,
          },
        },
        schema: z.object({ event_id: z.string() }),
        context: "matrixMessages.send",
      });
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
      aisha.removeChannel(channelRef.current);
    }

    const channel = aisha
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
          // Refetch messages when room state changes (bridge activity)
          queryClient.invalidateQueries({ queryKey: matrixKeys.messages(roomId) });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      aisha.removeChannel(channel);
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
