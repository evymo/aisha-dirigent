/**
 * Hook for managing the AI Provider Registry (admin).
 *
 * Parallel to useModelRegistry but for the PROVIDER catalog (anthropic,
 * openai, google-genai, llmgateway-io, ollama, ...) — distinct from
 * per-model rows.
 *
 * After PR #79 (WF_PROVIDER_HEALTH_PROBE), last_health_status flows in
 * automatically every 5 min — operators see live health state in UI.
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/** Zod schema for provider registry rows returned by get_provider_registry_admin. */
const ProviderRegistryRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  backend_kind: z.string(),
  endpoint_url: z.string().nullable(),
  health_url: z.string().nullable(),
  auth_env_var: z.string().nullable(),
  auth_kind: z.string(),
  supports_chat: z.boolean(),
  supports_tool_use: z.boolean(),
  supports_vision: z.boolean(),
  supports_batch: z.boolean(),
  supports_streaming: z.boolean(),
  is_enabled: z.boolean(),
  last_health_status: z.string(),
  last_health_checked_at: z.string().nullable(),
  last_health_detail: z.string().nullable(),
  // Consecutive non-healthy probes. Reset to 0 on first healthy probe by
  // record_provider_health_result, or operator-reset via useUpdateProvider's
  // resetFailureCount flag. Used by get_providers_due_health_probe for
  // exponential backoff schedule: 0-2=5min, 3-4=1h, 5-7=6h, 8+=24h.
  consecutive_failure_count: z.number().int().nonnegative(),
  cost_class: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Type for a single provider registry row. */
export type ProviderRegistryRow = z.infer<typeof ProviderRegistryRowSchema>;

/** Filter options for the provider registry query. */
export interface ProviderRegistryFilters {
  backendKind?: string;
  enabledOnly?: boolean;
}

/**
 * Fetches all providers from the AI provider registry (admin).
 *
 * Rows are sorted by is_enabled DESC, then health rank (healthy first),
 * then alphabetically by slug — so operators see most-relevant rows at top.
 *
 * @param filters - Optional filters for backend_kind, enabled-only.
 * @returns Query result with array of ProviderRegistryRow.
 */
export function useProviderRegistry(filters?: ProviderRegistryFilters) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["provider-registry", user?.id, filters],
    queryFn: async (): Promise<ProviderRegistryRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_provider_registry_admin", {
        p_backend_kind: filters?.backendKind,
        p_enabled_only: filters?.enabledOnly ?? false,
      });

      if (error) {
        safeError("useProviderRegistry.fetch", error);
        throw new Error(error.message);
      }

      return z.array(ProviderRegistryRowSchema).parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    // 30s stale — providers don't change often, but probe data refreshes
    // every 5 min via WF_PROVIDER_HEALTH_PROBE so this is enough freshness.
    staleTime: 30_000,
  });
}

/**
 * Mutation to update provider — toggle is_enabled, edit notes, or reset
 * the consecutive_failure_count (pulls provider out of probe backoff).
 *
 * NOTE: endpoint_url / auth_env_var / etc. are NOT editable here. Those
 * are seeded by migrations and changing them at runtime would require
 * coordinated env-var + compose updates. AdminProviderRegistry UI surfaces
 * them as read-only.
 *
 * resetFailureCount=true is useful when operator has manually confirmed a
 * previously-down provider is fixed and wants to immediately retest at the
 * base 5-minute cadence instead of waiting through the 1h/6h/24h backoff.
 *
 * @returns Mutation for toggling provider state.
 */
export function useUpdateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      providerId: string;
      isEnabled?: boolean;
      notes?: string;
      resetFailureCount?: boolean;
    }) => {
      const { data, error } = await aisha.rpc("update_provider_admin", {
        p_is_enabled: params.isEnabled,
        p_notes: params.notes,
        p_provider_id: params.providerId,
        p_reset_failure_count: params.resetFailureCount ?? false,
      });

      if (error) {
        safeError("useUpdateProvider.mutate", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-registry"] });
    },
  });
}
