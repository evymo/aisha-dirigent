/**
 * Hook for managing the AI Model Registry (admin).
 *
 * Provides CRUD operations for model approval, rejection,
 * and availability management via RPC-only pattern.
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/** Zod schema for model registry rows returned by get_model_registry_admin. */
const ModelRegistryRowSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  model_id: z.string(),
  display_name: z.string().nullable(),
  model_family: z.string().nullable(),
  is_reasoning: z.boolean(),
  is_vision: z.boolean(),
  is_function_calling: z.boolean(),
  context_window: z.number().nullable(),
  input_price_per_m: z.number().nullable(),
  output_price_per_m: z.number().nullable(),
  /** Prompt-cache READ rate ($/1M) — odysseus G1; null until seeded/scanned/overridden. */
  cached_input_price_per_m: z.number().nullable(),
  is_available: z.boolean(),
  is_deprecated: z.boolean(),
  eval_status: z.string(),
  latest_eval_score: z.number().nullable(),
  latest_eval_at: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  best_task_type: z.string().nullable(),
  best_task_score: z.number().nullable(),
});

/** Type for a single model registry row. */
export type ModelRegistryRow = z.infer<typeof ModelRegistryRowSchema>;

/** Filter options for the model registry query. */
export interface ModelRegistryFilters {
  provider?: string;
  evalStatus?: string;
  availableOnly?: boolean;
}

/**
 * Fetches all models from the AI model registry (admin).
 *
 * @param filters - Optional filters for provider, eval status, availability.
 * @returns Query result with array of ModelRegistryRow.
 */
export function useModelRegistry(filters?: ModelRegistryFilters) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["model-registry", user?.id, filters],
    queryFn: async (): Promise<ModelRegistryRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_model_registry_admin", {
        p_available_only: filters?.availableOnly ?? false,
        p_eval_status: filters?.evalStatus,
        p_provider: filters?.provider,
      });

      if (error) {
        safeError("useModelRegistry.fetch", error);
        throw new Error(error.message);
      }

      return z.array(ModelRegistryRowSchema).parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Mutation to approve a model for production use.
 *
 * @returns Mutation for approving a model by its registry ID.
 */
export function useApproveModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (modelRegistryId: string) => {
      const { data, error } = await aisha.rpc("approve_model_admin", {
        p_model_registry_id: modelRegistryId,
      });

      if (error) {
        safeError("useApproveModel.mutate", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
    },
  });
}

/**
 * Mutation to reject a model from production use.
 *
 * @returns Mutation for rejecting a model with optional reason.
 */
export function useRejectModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ modelRegistryId, reason }: { modelRegistryId: string; reason?: string }) => {
      const { data, error } = await aisha.rpc("reject_model_admin", {
        p_model_registry_id: modelRegistryId,
        p_reason: reason,
      });

      if (error) {
        safeError("useRejectModel.mutate", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
    },
  });
}

/** Summary returned by the on-demand discover→self-test run (matches the route's payload). */
export interface DiscoverModelsResult {
  discovered: number;
  perProvider: Record<string, number>;
  tested: number;
  passed: number;
  failed: number;
  errors: Array<{ provider: string; error: string }>;
}

/**
 * Mutation to trigger model discovery + self-test ON DEMAND (the same pipeline that
 * runs at svc-ai-chat boot), via the gateway-routed `discover-models` function. Newly
 * found models land eval_status='pending' (is_available=true → immediately visible in
 * this registry); the self-test advances them. Invalidates the registry on success so
 * the new rows appear without a manual refresh.
 *
 * @returns Mutation; pass `{ provider }` to rescan one backend family, or
 *   `{ mode: 'rejected-only' | 'all-settled' }` to re-test already-settled models
 *   (skips discovery — re-probes + forces the verdict on a settled model).
 */
export function useDiscoverModels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: { provider?: string; mode?: "pending" | "rejected-only" | "all-settled" }): Promise<DiscoverModelsResult> => {
      const { data, error } = await aisha.functions.invoke("discover-models", {
        body: { provider: params?.provider, mode: params?.mode },
      });

      if (error) {
        safeError("useDiscoverModels.mutate", error);
        throw new Error(error.message);
      }

      return data as DiscoverModelsResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
    },
  });
}

/**
 * Mutation to update model availability/deprecation status.
 *
 * @returns Mutation for toggling model properties.
 */
export function useUpdateModelRegistry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      modelRegistryId: string;
      isAvailable?: boolean;
      isDeprecated?: boolean;
      displayName?: string;
      /** Operator price overrides ($/1M). Omitted fields leave the scanned/seeded value. */
      inputPricePerM?: number;
      outputPricePerM?: number;
      cachedInputPricePerM?: number;
    }) => {
      const { data, error } = await aisha.rpc("update_model_registry_admin", {
        p_display_name: params.displayName,
        p_is_available: params.isAvailable,
        p_is_deprecated: params.isDeprecated,
        p_model_registry_id: params.modelRegistryId,
      });

      if (error) {
        safeError("useUpdateModelRegistry.mutate", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
    },
  });
}

/** Summary returned by the on-demand quality benchmark run. */
export interface BenchmarkRunResult {
  evalRunId: string | null;
  modelsBenchmarked: number;
  perModel: Array<{ modelId: string; taskType: string; overall: number; sampleCount: number }>;
}

/**
 * Mutation to run the QUALITY benchmark on demand (heuristic + LLM-as-judge) over
 * available models, via the gateway-routed `run-benchmark` function. Records one current
 * `ai_model_benchmarks` row per (model, task_type); the aggregate score then feeds the
 * resolver ranking. Invalidates the registry so refreshed scores surface.
 *
 * @returns Mutation; pass `{ modelIds }` to benchmark a subset, `{ useJudge: false }` for heuristic-only.
 */
export function useBenchmarkModels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: { modelIds?: string[]; useJudge?: boolean }): Promise<BenchmarkRunResult> => {
      const { data, error } = await aisha.functions.invoke("run-benchmark", {
        body: { model_ids: params?.modelIds, useJudge: params?.useJudge },
      });

      if (error) {
        safeError("useBenchmarkModels.mutate", error);
        throw new Error(error.message);
      }

      return data as BenchmarkRunResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
    },
  });
}
