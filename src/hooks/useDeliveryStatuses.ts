/**
 * useDeliveryStatuses — delivery pipeline metadata lookup.
 *
 * Wraps the `list_delivery_statuses` RPC. Exposes per-status governance
 * flags (`requires_approval`, `restricts_actions`) that the chat-side
 * governance layer (services/svc-ai-chat/src/lib/governedOrchestration.ts)
 * also consumes server-side.
 *
 * UI consumers should call `t(status.label_i18n_key)` for display.
 *
 * @module hooks/useDeliveryStatuses
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schema
// ============================================================================

const DeliveryStatusRowSchema = z.object({
  status: z.string(),
  label_i18n_key: z.string(),
  sort_order: z.number().int(),
  swimlane_color: z.string().nullable(),
  requires_approval: z.boolean(),
  restricts_actions: z.boolean(),
  is_terminal: z.boolean(),
  is_active: z.boolean(),
});

const DeliveryStatusArraySchema = z.array(DeliveryStatusRowSchema);

/** Single row from list_delivery_statuses. */
export type DeliveryStatus = z.infer<typeof DeliveryStatusRowSchema>;

// ============================================================================
// Hook
// ============================================================================

interface UseDeliveryStatusesOptions {
  /** Include inactive statuses (for admin status manager). */
  includeInactive?: boolean;
  /** Disable the query. */
  enabled?: boolean;
}

/**
 * Fetches delivery pipeline statuses with governance flags, ordered by
 * sort_order ASC.
 *
 * @example
 * ```tsx
 * const { data: statuses = [] } = useDeliveryStatuses();
 * const approvalRequired = new Set(
 *   statuses.filter((s) => s.requires_approval).map((s) => s.status),
 * );
 * ```
 */
export function useDeliveryStatuses(opts: UseDeliveryStatusesOptions = {}) {
  const { includeInactive = false, enabled = true } = opts;

  return useQuery({
    queryKey: ["delivery_statuses", { includeInactive }],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DeliveryStatus[]> => {
      const { data, error } = await aisha.rpc("list_delivery_statuses", {
        p_include_inactive: includeInactive,
      });

      if (error) {
        safeError("useDeliveryStatuses", error);
        throw error;
      }

      return DeliveryStatusArraySchema.parse(data ?? []);
    },
  });
}

/**
 * Convenience selector — returns a Map keyed by status code for O(1) lookup.
 */
export function useDeliveryStatusMap(opts: UseDeliveryStatusesOptions = {}) {
  const query = useDeliveryStatuses(opts);
  const map = new Map<string, DeliveryStatus>();
  for (const row of query.data ?? []) {
    map.set(row.status, row);
  }
  return { ...query, statusMap: map };
}
