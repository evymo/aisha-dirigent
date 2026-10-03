/**
 * Quarantined knowledge items — admin review queue (Step 4 systemic).
 *
 * Two hooks:
 *   - useQuarantinedKnowledge(limit, offset) — read fn_list_quarantined_items
 *   - useReinstateKnowledgeItem() — mutation: fn_reinstate_knowledge_item_audited
 *
 * Both gate via hasPermission("view_admin_panel"). Reinstate writes an audit
 * row tied to the admin user — full provenance for downstream review.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";

export const QuarantinedKnowledgeItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  item_type: z.string(),
  quarantine_status: z.enum(["flagged", "quarantined", "reviewed", "reinstated"]),
  quarantine_reason: z.string().nullable(),
  quarantine_metadata: z.record(z.string(), z.unknown()).nullable(),
  safety_score: z.number().nullable(),
  safety_scanned_at: z.string().nullable(),
  story_id: z.string().uuid().nullable(),
  created_at: z.string(),
});

export type QuarantinedKnowledgeItem = z.infer<typeof QuarantinedKnowledgeItemSchema>;

export function useQuarantinedKnowledge(limit = 50, offset = 0) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: ["quarantined-knowledge", limit, offset],
    queryFn: async (): Promise<QuarantinedKnowledgeItem[]> => {
      const { data, error } = await aisha.rpc("fn_list_quarantined_items", {
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];
      return data
        .map((row) => {
          const parsed = QuarantinedKnowledgeItemSchema.safeParse(row);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is QuarantinedKnowledgeItem => x !== null);
    },
    enabled: !!user && hasPermission("view_admin_panel"),
    staleTime: 30_000,
  });
}

export function useReinstateKnowledgeItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { itemId: string; reason: string }): Promise<void> => {
      const { error } = await aisha.rpc("fn_reinstate_knowledge_item_audited", {
        p_item_id: args.itemId,
        p_reason: args.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quarantined-knowledge"] });
    },
    onError: (err) => safeError("useReinstateKnowledgeItem.failed", err),
  });
}
