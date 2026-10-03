/**
 * Hook for managing the AI Runtime Registry (admin) — the runtime/executor axis
 * (direct_llm / openclaw / hermes / cli / workflow / human), sibling of
 * useProviderRegistry + useModelRegistry.
 *
 * adapter_health flows in from WF_RUNTIME_HEALTH_PROBE (record_runtime_health_result)
 * so operators see live runtime reachability. Toggle is_enabled via the audited
 * write update_runtime_admin_audited (keyed by slug).
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/** Zod schema for runtime registry rows returned by get_runtimes_admin. */
const RuntimeRegistryRowSchema = z.object({
  id: z.string().uuid(),
  runtime_kind: z.string(),
  slug: z.string(),
  display_name: z.string(),
  is_enabled: z.boolean(),
  adapter_health: z.string(),
  adapter_health_checked_at: z.string().nullable(),
  // Consecutive non-healthy probes — reset to 0 on first healthy probe by
  // record_runtime_health_result; feeds get_runtimes_due_health_probe backoff.
  consecutive_failure_count: z.number().int().nonnegative(),
  can_write: z.boolean(),
  needs_network: z.boolean(),
  supports_tools: z.boolean(),
  side_effect_class: z.string(),
  autonomy_class: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Type for a single runtime registry row. */
export type RuntimeRegistryRow = z.infer<typeof RuntimeRegistryRowSchema>;

/** Filter options for the runtime registry query. */
export interface RuntimeRegistryFilters {
  runtimeKind?: string;
  enabledOnly?: boolean;
}

/**
 * Fetches all runtimes from the AI runtime registry (admin). Sorted by
 * is_enabled DESC, adapter_health rank, then slug.
 */
export function useRuntimeRegistry(filters?: RuntimeRegistryFilters) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["runtime-registry", user?.id, filters],
    queryFn: async (): Promise<RuntimeRegistryRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_runtimes_admin", {
        p_enabled_only: filters?.enabledOnly ?? false,
        p_runtime_kind: filters?.runtimeKind,
      });

      if (error) {
        safeError("useRuntimeRegistry.fetch", error);
        throw new Error(error.message);
      }

      return z.array(RuntimeRegistryRowSchema).parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    // adapter_health refreshes every 5 min via WF_RUNTIME_HEALTH_PROBE.
    staleTime: 30_000,
  });
}

/**
 * Mutation to toggle a runtime's is_enabled via the audited write
 * update_runtime_admin_audited (keyed by slug). Disabling does NOT delete the
 * seed row; the operator's choice is preserved across migrations.
 */
export function useUpdateRuntime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { slug: string; isEnabled?: boolean }) => {
      const { data, error } = await aisha.rpc("update_runtime_admin_audited", {
        p_is_enabled: params.isEnabled,
        p_slug: params.slug,
      });

      if (error) {
        safeError("useUpdateRuntime.mutate", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime-registry"] });
    },
  });
}
