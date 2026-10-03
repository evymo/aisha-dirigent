/**
 * useStoryFaithfulnessTrend — Phase 12 WP 1.5.
 *
 * Returns the last N (default 50) faithfulness scores for a story, joined
 * from ai_runs.faithfulness_score_estimate. Powers the trend sparkline on
 * AdminStoryDetail Overview tab.
 *
 * RLS: re-enforced in the RPC (admin/staff OR story_participant OR
 * stack-default story). Hook calls RPC via aisha.rpc + Zod parse.
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";

const FaithfulnessPointSchema = z.object({
  run_id: z.string().uuid(),
  faithfulness: z.number().min(0).max(1).nullable(),
  agent_slug: z.string().nullable(),
  kind: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export type FaithfulnessPoint = z.infer<typeof FaithfulnessPointSchema>;

const FaithfulnessPointArraySchema = z.array(FaithfulnessPointSchema);

export interface UseStoryFaithfulnessTrendArgs {
  storyId: string | null | undefined;
  limit?: number;
}

export function useStoryFaithfulnessTrend(args: UseStoryFaithfulnessTrendArgs) {
  const { user } = useSession();
  const { storyId, limit = 50 } = args;

  return useQuery({
    queryKey: ["story-faithfulness-trend", storyId ?? null, limit],
    queryFn: async (): Promise<FaithfulnessPoint[]> => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc(
        "fn_list_story_faithfulness_trend",
        { p_story_id: storyId, p_limit: limit },
      );
      if (error) {
        safeError("useStoryFaithfulnessTrend.rpc_error", error);
        throw new Error(error.message);
      }
      if (!data || !Array.isArray(data)) return [];
      const parsed = FaithfulnessPointArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useStoryFaithfulnessTrend.parse_error", parsed.error.issues);
        return [];
      }
      return parsed.data;
    },
    enabled: !!user && !!storyId,
    // Per WP 2.5 staleTime category guidance — story-scoped data, refresh on
    // mount but not too aggressively. Real-time updates handled separately
    // via useLiveTable for ai_runs UPDATE if needed.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Categorize a faithfulness score into ux-friendly tiers.
 * Aligns with existing FaithfulnessChip (faithfulnessTier in useRunCitations).
 */
export function faithfulnessTierFor(
  score: number | null | undefined,
): "high" | "medium" | "low" | "noData" {
  if (score === null || score === undefined) return "noData";
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

/**
 * Compute aggregate stats across the trend window: avg + last + tier counts.
 * Returns null when the input is empty (caller renders an empty-state).
 */
export function computeTrendStats(points: ReadonlyArray<FaithfulnessPoint>): {
  count: number;
  avg: number;
  latest: number | null;
  high: number;
  medium: number;
  low: number;
} | null {
  const withScore = points.filter(
    (p): p is FaithfulnessPoint & { faithfulness: number } =>
      p.faithfulness !== null,
  );
  if (withScore.length === 0) return null;

  const sum = withScore.reduce((s, p) => s + p.faithfulness, 0);
  const avg = sum / withScore.length;
  // Points are ordered DESC by started_at — index 0 is the latest
  const latest = withScore[0]?.faithfulness ?? null;
  const high = withScore.filter((p) => p.faithfulness >= 0.85).length;
  const medium = withScore.filter(
    (p) => p.faithfulness >= 0.6 && p.faithfulness < 0.85,
  ).length;
  const low = withScore.filter((p) => p.faithfulness < 0.6).length;

  return { count: withScore.length, avg, latest, high, medium, low };
}
