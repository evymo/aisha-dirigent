/**
 * RAG retrieval-quality baseline hooks (Step 0 of optimization plan 2026).
 *
 * Provides React Query hooks for:
 *   - useRagBaseline — aggregated metrics (faithfulness, recall, precision)
 *                     used by AdminAiObservability for the RAG metrics row.
 *   - useRagRunDetail — single run detail incl. question + answer + scores
 *                       used by admin drill-down (future step).
 *
 * All hooks parse responses through Zod schemas (RagBaselineSchema,
 * RagRunDetailSchema) before returning. Admin/staff permission required.
 *
 * @module hooks/useRagBaseline
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import {
  RagBaselineSchema,
  RagRunDetailSchema,
  type RagBaseline,
  type RagRunDetail,
} from "@/schemas/rpcResponseSchemas";

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Aggregated retrieval-quality metrics for the last N hours.
 *
 * Returns one row per (context_profile_slug × embedding_model × llm_model)
 * combination present in rag_eval_runs within the window. The dashboard tile
 * usually filters down to a single profile or averages across all.
 *
 * @param profileSlug   Optional filter to a single context_profile (e.g. 'evidence_strict')
 * @param embeddingModel Optional filter to embedding model (e.g. 'qwen3-embedding-4b')
 * @param periodHours   Rolling window in hours (default 168 = 7 days)
 */
export function useRagBaseline(
  profileSlug?: string | null,
  embeddingModel?: string | null,
  periodHours: number = 168,
) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: ["rag-baseline", profileSlug ?? null, embeddingModel ?? null, periodHours],
    queryFn: async (): Promise<RagBaseline[]> => {
      const { data, error } = await aisha.rpc("fn_get_rag_baseline", {
        p_embedding_model: embeddingModel ?? undefined,
        p_period_hours: periodHours,
        p_profile_slug: profileSlug ?? undefined,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((row) => {
          const parsed = RagBaselineSchema.safeParse(row);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is RagBaseline => x !== null);
    },
    enabled: !!user && hasPermission("view_admin_panel"),
    staleTime: 60_000,
  });
}

/**
 * Detail for a single rag_eval_run: question, ground-truth, generated answer,
 * all 4 scores, retrieved chunk IDs, latency, metadata.
 *
 * @param runId UUID of the rag_eval_runs row to inspect
 */
export function useRagRunDetail(runId: string | null | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: ["rag-run-detail", runId ?? null],
    queryFn: async (): Promise<RagRunDetail | null> => {
      if (!runId) return null;
      const { data, error } = await aisha.rpc("fn_get_rag_run_detail", {
        p_run_id: runId,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data) || data.length === 0) return null;

      const parsed = RagRunDetailSchema.safeParse(data[0]);
      return parsed.success ? parsed.data : null;
    },
    enabled: !!user && !!runId && hasPermission("view_admin_panel"),
    staleTime: 30_000,
  });
}

// ============================================================================
// Convenience selectors (UI helpers)
// ============================================================================

/**
 * Average a single metric across all profile/model combinations in the baseline.
 *
 * Useful for dashboard tiles that want a single "overall faithfulness" number
 * rather than a per-profile breakdown.
 */
export function averageMetric(
  rows: RagBaseline[] | undefined,
  metric: "faithfulness_avg" | "answer_relevancy_avg" | "context_precision_avg" | "context_recall_avg" | "composite_avg",
): number | null {
  if (!rows || rows.length === 0) return null;
  const weighted = rows.reduce(
    (acc, r) => {
      const value = r[metric];
      if (value === null || value === undefined) return acc;
      return { sum: acc.sum + value * r.n_runs, count: acc.count + r.n_runs };
    },
    { sum: 0, count: 0 },
  );
  if (weighted.count === 0) return null;
  return weighted.sum / weighted.count;
}
