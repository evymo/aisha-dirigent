/**
 * Cosmos Ledger Status Hook — admin dashboard stats for blockchain audit records.
 *
 * Queries `get_cosmos_ledger_status_admin` RPC to return
 * pending/confirmed/failed counts and last sync timestamp.
 * Requires admin or staff role.
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "@/hooks/usePermissions";

// ── Schema ───────────────────────────────────────────────────
const cosmosLedgerStatusSchema = z.object({
  confirmed: z.number(),
  failed: z.number(),
  last_sync: z.string().nullable(),
  pending: z.number(),
  total: z.number(),
});

/** Cosmos ledger sync stats from blockchain_audit_records. */
export type CosmosLedgerStatus = z.infer<typeof cosmosLedgerStatusSchema>;

// ── Hook ─────────────────────────────────────────────────────

/** Fetches aggregated blockchain audit stats for admin dashboard. */
export function useCosmosLedgerStatus() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery<CosmosLedgerStatus>({
    queryKey: ["cosmos-ledger-status"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc(
        "get_cosmos_ledger_status_admin",
      );
      if (error) throw error;
      return cosmosLedgerStatusSchema.parse(data);
    },
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    meta: {
      errorHandler: (err: unknown) => {
        safeError("cosmos.ledger.status.failed", err);
      },
    },
  });
}
