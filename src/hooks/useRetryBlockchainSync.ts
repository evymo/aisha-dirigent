/**
 * @module useRetryBlockchainSync
 * @description Admin mutation hook for resetting stale blockchain sync records.
 * Records stuck in 'processing' state beyond timeout are reset to 'failed' (with retry)
 * or 'exhausted' (when max_attempts reached).
 * Calls: reset_stale_processing(p_timeout_minutes)
 * Requires admin or staff role.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";

/** Parameters for resetting stale blockchain sync records. */
export interface RetryBlockchainSyncParams {
  /** Timeout in minutes for considering a record stale. Default: 5. */
  timeoutMinutes?: number;
}

const retryParamsSchema = z.object({
  timeoutMinutes: z.number().int().min(1).max(60).default(5),
});

/**
 * Admin hook for resetting stale blockchain sync records.
 * Returns `{ isAdmin, resetStale }` where resetStale is a mutation
 * that returns the count of records reset.
 */
export function useRetryBlockchainSync() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const resetStale = useMutation<number, Error, RetryBlockchainSyncParams>({
    mutationFn: async (params) => {
      const validated = retryParamsSchema.parse(params);

      const { data, error } = await aisha.rpc("reset_stale_processing", {
        p_timeout_minutes: validated.timeoutMinutes,
      });

      if (error) throw error;
      return z.number().parse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cosmos-ledger-status"] });
      queryClient.invalidateQueries({ queryKey: ["blockchain-audit"] });
    },
    onError: (err) => {
      safeError("blockchain.retry.reset.failed", err);
    },
  });

  return { isAdmin, resetStale };
}
