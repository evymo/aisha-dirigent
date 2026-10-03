/**
 * Hook for SLA tracking on Matrix rooms — tracks response times
 * and triggers auto-escalation when SLA thresholds are breached.
 *
 * SLA policy:
 *   - First response: ≤ 15 min (warning), ≤ 30 min (breach → auto-escalate)
 *   - Auto-escalation: AISHA posts reminder, assigns next-available expert
 *
 * @module hooks/useSlaTracking
 */

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { invokeEdgeFunction } from "@/integrations/api/edge";
import { safeError, safeInfo, safeWarn } from "@/lib/security/safeLogger";
import { z } from "zod";

import type { RealtimeChannel } from "@/integrations/api/realtime";

// =============================================================================
// Schemas
// =============================================================================

const slaStatusSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  matrix_room_id: z.string(),
  first_message_at: z.string().nullable(),
  first_response_at: z.string().nullable(),
  response_time_ms: z.number().nullable(),
  sla_breached: z.boolean(),
  escalated_at: z.string().nullable(),
  escalated_to: z.string().uuid().nullable(),
  created_at: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export interface SlaStatus {
  id: string;
  storyId: string;
  matrixRoomId: string;
  firstMessageAt: string | null;
  firstResponseAt: string | null;
  responseTimeMs: number | null;
  slaBreached: boolean;
  escalatedAt: string | null;
  escalatedTo: string | null;
}

export interface SlaThresholds {
  warningMs: number;
  breachMs: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_THRESHOLDS: SlaThresholds = {
  warningMs: 15 * 60 * 1000,  // 15 minutes
  breachMs: 30 * 60 * 1000,   // 30 minutes
};

// =============================================================================
// Keys
// =============================================================================

const slaKeys = {
  all: ["sla"] as const,
  status: (storyId: string) => [...slaKeys.all, "status", storyId] as const,
  dashboard: (userId: string) => [...slaKeys.all, "dashboard", userId] as const,
};

// =============================================================================
// Hook
// =============================================================================

export function useSlaTracking(
  storyId: string | null,
  userId: string | undefined,
  thresholds: SlaThresholds = DEFAULT_THRESHOLDS
) {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ─── Query: SLA status for story ───────────────────────────
  const slaStatus = useQuery({
    queryKey: slaKeys.status(storyId ?? ""),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_sla_status", {
        p_story_id: storyId ?? "",
      });

      if (error) {
        safeWarn("slaTracking.fetch", error);
        return null;
      }

      const row = data?.[0];
      if (!row) return null;

      return {
        id: row.id,
        storyId: row.story_id,
        matrixRoomId: row.matrix_room_id,
        firstMessageAt: row.first_message_at,
        firstResponseAt: row.first_response_at,
        responseTimeMs: row.response_time_ms,
        slaBreached: row.sla_breached,
        escalatedAt: row.escalated_at,
        escalatedTo: row.escalated_to,
      } satisfies SlaStatus;
    },
    enabled: !!storyId && !!userId,
    staleTime: 30_000,
  });

  // ─── SLA dashboard for user (all active SLAs) ─────────────
  const slaDashboard = useQuery({
    queryKey: slaKeys.dashboard(userId ?? ""),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_sla_dashboard");

      if (error) {
        safeWarn("slaTracking.dashboard", error);
        return [];
      }

      return (data ?? []).map((d) => ({
        id: d.id,
        storyId: d.story_id,
        matrixRoomId: d.matrix_room_id,
        firstMessageAt: d.first_message_at,
        firstResponseAt: d.first_response_at,
        responseTimeMs: d.response_time_ms,
        slaBreached: d.sla_breached,
        escalatedAt: d.escalated_at,
        escalatedTo: d.escalated_to,
      })) satisfies SlaStatus[];
    },
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 60_000, // Refresh every minute to track SLA countdown
  });

  // ─── Record first response ─────────────────────────────────
  const recordResponse = useMutation({
    mutationFn: async (slaId: string) => {
      const { error } = await aisha.rpc("record_sla_response", {
        p_sla_id: slaId,
      });

      if (error) throw error;

      safeInfo("slaTracking.responseRecorded", { slaId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: slaKeys.all });
    },
  });

  // ─── Trigger escalation ────────────────────────────────────
  const triggerEscalation = useMutation({
    mutationFn: async (slaId: string) => {
      const { error } = await aisha.rpc("trigger_sla_escalation", {
        p_sla_id: slaId,
      });

      if (error) throw error;

      safeInfo("slaTracking.escalated", { slaId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: slaKeys.all });
    },
  });

  // ─── Realtime: SLA changes ────────────────────────────────
  useEffect(() => {
    if (!storyId) return;

    if (channelRef.current) {
      aisha.removeChannel(channelRef.current);
    }

    const channel = aisha
      .channel(`sla-tracking-${storyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sla_tracking",
          filter: `story_id=eq.${storyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: slaKeys.status(storyId) });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      aisha.removeChannel(channel);
      channelRef.current = null;
    };
  }, [storyId, queryClient]);

  // ─── Computed helpers ──────────────────────────────────────
  const currentSla = slaStatus.data;
  const isWaiting = currentSla && !currentSla.firstResponseAt;
  const waitingMs = isWaiting && currentSla.firstMessageAt
    ? Date.now() - new Date(currentSla.firstMessageAt).getTime()
    : 0;
  const isWarning = waitingMs > thresholds.warningMs && waitingMs <= thresholds.breachMs;
  const isBreach = waitingMs > thresholds.breachMs;

  return {
    slaStatus: currentSla,
    slaDashboard: slaDashboard.data ?? [],
    recordResponse,
    triggerEscalation,
    isWaiting: !!isWaiting,
    waitingMs,
    isWarning,
    isBreach,
    thresholds,
  };
}
