/**
 * Platform warmup state — Step W1 of admin warmup wizard.
 *
 * Two hooks:
 *   - usePlatformWarmupState()    — read fn_get_platform_warmup_state
 *   - useMarkWarmupStep()         — mutation: fn_mark_warmup_step_completed_audited
 *
 * Both gate via hasPermission("view_admin_panel"). The wizard surface
 * (AdminWarmupWizard.tsx) and the optional auto-redirect from /admin
 * read the state to decide whether the wizard should appear.
 *
 * No new table — state lives in audit_journal as a sequence of
 * action='warmup.step_completed' rows. The hook just renders the
 * server-side derived view.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  PlatformWarmupStateSchema,
  WarmupStepCompletedSchema,
  type PlatformWarmupState,
  type WarmupStep,
  type WarmupStepCompleted,
} from "@/schemas/rpcResponseSchemas";

const QUERY_KEY = ["platform-warmup-state"] as const;

/**
 * Reads the current warmup state. Returns `null` while loading and
 * surfaces the parsed PlatformWarmupState once the RPC returns.
 *
 * staleTime 30s — wizard transitions are user-paced; refetch on tab focus
 * picks up any concurrent admin's progress.
 */
export function usePlatformWarmupState() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<PlatformWarmupState | null> => {
      const { data, error } = await aisha.rpc("fn_get_platform_warmup_state");
      if (error) {
        safeError("usePlatformWarmupState.rpc.failed", error);
        throw new Error(error.message);
      }
      if (!data) return null;
      const parsed = PlatformWarmupStateSchema.safeParse(data);
      if (!parsed.success) {
        safeError("usePlatformWarmupState.parse.failed", parsed.error);
        return null;
      }
      return parsed.data;
    },
    // Only fire for admin/staff who can actually view the wizard.
    enabled: !!user && hasPermission("view_admin_panel"),
    staleTime: 30_000,
  });
}

/**
 * Marks one warmup step completed. Invalidates the warmup state query
 * on success so the wizard re-renders with the new completed_steps set.
 */
export function useMarkWarmupStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      step: WarmupStep;
      metadata?: Record<string, unknown>;
    }): Promise<WarmupStepCompleted> => {
      const { data, error } = await aisha.rpc("fn_mark_warmup_step_completed_audited", {
        p_metadata: (args.metadata ?? {}) as unknown as Json,
        p_step: args.step,
      });
      if (error) {
        safeError("useMarkWarmupStep.rpc.failed", error);
        throw new Error(error.message);
      }
      const parsed = WarmupStepCompletedSchema.safeParse(data);
      if (!parsed.success) {
        safeError("useMarkWarmupStep.parse.failed", parsed.error);
        throw new Error("Failed to parse warmup step response");
      }
      return parsed.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
