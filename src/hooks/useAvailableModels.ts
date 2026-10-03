/**
 * Hook for fetching available OpenAI models from the API.
 *
 * Calls the `list-openai-models` edge function and returns
 * a sorted list of chat-capable models. Falls back to a static
 * list when the API is unreachable or returns an error.
 *
 * @module
 */
import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

/** Model entry returned by the edge function. */
export interface OpenAiModelEntry {
  id: string;
  created: number;
  owned_by: string;
}

/**
 * Fallback model IDs when the API is unreachable.
 * Configurable via VITE_FALLBACK_MODEL_IDS (comma-separated) at build time.
 */
const FALLBACK_MODEL_IDS = (
  (import.meta.env.VITE_FALLBACK_MODEL_IDS as string | undefined)
    ?.split(",").map((s) => s.trim()).filter(Boolean)
  ?? ["gpt-4o", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-5-nano", "o1-preview", "o1-mini", "o3-mini"]
);
const FALLBACK_MODELS: OpenAiModelEntry[] = FALLBACK_MODEL_IDS.map((id) => ({ id, created: 0, owned_by: "system" }));

/**
 * Fetches available OpenAI models via the edge function.
 *
 * @returns Query result with `models` array and `isFallback` flag.
 *
 * @example
 * ```ts
 * const { data, isLoading } = useAvailableModels();
 * // data?.models => OpenAiModelEntry[]
 * // data?.isFallback => boolean
 * ```
 */
export function useAvailableModels() {
  return useQuery({
    queryKey: ["available-openai-models"],
    queryFn: async (): Promise<{ isFallback: boolean; models: OpenAiModelEntry[] }> => {
      try {
        const { data, error } = await aisha.functions.invoke("list-openai-models");

        if (error) {
          safeError("useAvailableModels.invoke", error);
          return { isFallback: true, models: FALLBACK_MODELS };
        }

        const models = (data as { models?: unknown } | null | undefined)?.models;
        if (!Array.isArray(models) || models.length === 0) {
          return { isFallback: true, models: FALLBACK_MODELS };
        }

        return {
          isFallback: false,
          models: models as OpenAiModelEntry[],
        };
      } catch (err) {
        safeError("useAvailableModels.catch", err);
        return { isFallback: true, models: FALLBACK_MODELS };
      }
    },
    staleTime: 5 * 60 * 1000, // 5 min — models list changes infrequently
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });
}
