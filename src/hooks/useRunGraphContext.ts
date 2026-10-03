/**
 * useRunGraphContext — Step 7.3 of retrieval optimization plan 2026.
 *
 * Returns the multi-hop graph context for an ai_run: which Concepts /
 * ExpertRules / Memories / past Runs the cited knowledge items connect
 * to in the Hippocampus graph. Powers ExplainabilityPanel.tsx.
 *
 * Source RPC: fn_get_run_graph_context(p_run_id, p_depth NULL, p_per_seed NULL).
 * Depth + per-seed limits resolved server-side from context_profiles via
 * the profile_slug lodged in ai_runs.metadata.context.profile_slug.
 *
 * Hook-Only Data Access: aisha.rpc() + Zod parse, mirroring useRunCitations.
 *
 * Grouped helper: `groupByTarget` collapses the flat row-per-edge return
 * into a per-target list (Concept X discovered via seeds A, B and C),
 * keeping the highest cumulative_confidence for each target. The
 * ExplainabilityPanel uses this to dedupe identical concepts surfaced
 * via multiple citation seeds.
 */
import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import {
  GraphContextRowSchema,
  type GraphContextRow,
} from "@/schemas/rpcResponseSchemas";
import { groupByTarget, type GroupedGraphContext } from "@/lib/graph/groupGraphContext";

// Re-export so existing imports (barrel, ExplainabilityPanel) don't need to change.
export { groupByTarget, type GroupedGraphContext };

export function useRunGraphContext(runId: string | null | undefined) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["run-graph-context", runId ?? null],
    queryFn: async (): Promise<GraphContextRow[]> => {
      if (!runId) return [];
      const { data, error } = await aisha.rpc("fn_get_run_graph_context", {
        p_depth: undefined,
        p_per_seed: undefined,
        p_run_id: runId,
      });
      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];
      return data
        .map((row) => {
          const parsed = GraphContextRowSchema.safeParse(row);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is GraphContextRow => x !== null);
    },
    enabled: !!user && !!runId,
    staleTime: 60_000,
  });
}

// groupByTarget moved to src/lib/graph/groupGraphContext.ts so it can be
// unit-tested without pulling in the realtime/db client through this file.
// Re-exported above for backwards compatibility.
