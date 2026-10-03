/**
 * Hook for monitoring Dirigent moderation sessions and decisions (admin).
 *
 * Provides paginated list of sessions with decision counts,
 * and detail-level decision listing per session.
 * Read-only admin view — sessions are created by Dirigent RPCs.
 * Uses RPC-only pattern with SECURITY DEFINER + is_admin_or_staff() checks.
 *
 * @module hooks/useModerationAdmin
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  moderationSessionAdminArraySchema,
  moderationDecisionArraySchema,
  type ModerationSessionAdminRow,
  type ModerationDecisionRow,
} from "@/lib/schemas/expertOverlaySchemas";

/** Query key factory for moderation admin */
export const moderationAdminKeys = {
  all: ["moderation-admin"] as const,
  sessions: (filters?: {
    status?: string;
    sessionType?: string;
    limit?: number;
    offset?: number;
  }) => [...moderationAdminKeys.all, "sessions", filters] as const,
  decisions: (sessionId: string | undefined) =>
    [...moderationAdminKeys.all, "decisions", sessionId] as const,
};

/**
 * Hook for fetching paginated moderation sessions (admin).
 *
 * @param options - Optional filters: status, sessionType, limit, offset.
 * @returns Query object with parsed session rows including decision counts.
 * @example
 * const { data: sessions } = useModerationSessions({ status: "active", limit: 20 });
 */
export function useModerationSessions(options?: {
  status?: string;
  sessionType?: string;
  limit?: number;
  offset?: number;
}) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const status = options?.status ?? null;
  const sessionType = options?.sessionType ?? null;

  return useQuery({
    queryKey: moderationAdminKeys.sessions({
      status: status ?? undefined,
      sessionType: sessionType ?? undefined,
      limit,
      offset,
    }),
    queryFn: async (): Promise<ModerationSessionAdminRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc(
        "get_moderation_sessions_admin",
        {
          p_limit: limit,
          p_offset: offset,
          p_status: status ?? undefined,
          p_session_type: sessionType ?? undefined,
        },
      );

      if (error) {
        safeError("useModerationSessions.fetch", error);
        throw new Error(error.message);
      }

      return moderationSessionAdminArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/**
 * Hook for fetching decisions for a specific moderation session.
 *
 * @param sessionId - UUID of the moderation session to get decisions for.
 * @returns Query object with parsed decision rows.
 * @example
 * const { data: decisions } = useModerationDecisions(selectedSessionId);
 */
export function useModerationDecisions(sessionId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: moderationAdminKeys.decisions(sessionId),
    queryFn: async (): Promise<ModerationDecisionRow[]> => {
      if (!sessionId || !isAdmin) return [];

      const { data, error } = await aisha.rpc(
        "get_moderation_decisions_admin",
        {
          p_session_id: sessionId,
        },
      );

      if (error) {
        safeError("useModerationDecisions.fetch", error);
        throw new Error(error.message);
      }

      return moderationDecisionArraySchema.parse(data ?? []);
    },
    enabled: !!user && !!sessionId && isAdmin,
    staleTime: 5_000,
  });
}
