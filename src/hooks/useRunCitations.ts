/**
 * Citations + faithfulness hooks for chat AI runs (Step 2 of optimization plan 2026).
 *
 * - useRunCitations(runId)         → CitationPanel.tsx
 * - useRunFaithfulness(runId)      → FaithfulnessChip.tsx
 * - useSubmitMessageFeedback()     → FeedbackButtons.tsx
 *
 * Hook-Only Data Access: all calls via aisha.rpc() + Zod parse.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";
import {
  CitationSchema,
  FaithfulnessScoreSchema,
  type Citation,
  type FaithfulnessScore,
} from "@/schemas/rpcResponseSchemas";

export function useRunCitations(runId: string | null | undefined) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["run-citations", runId ?? null],
    queryFn: async (): Promise<Citation[]> => {
      if (!runId) return [];
      const { data, error } = await aisha.rpc("fn_get_run_citations", {
        p_run_id: runId,
      });
      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];
      return data
        .map((r) => {
          const parsed = CitationSchema.safeParse(r);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is Citation => x !== null);
    },
    enabled: !!user && !!runId,
    staleTime: 30_000,
  });
}

export function useRunFaithfulness(runId: string | null | undefined) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["run-faithfulness", runId ?? null],
    queryFn: async (): Promise<FaithfulnessScore | null> => {
      if (!runId) return null;
      const { data, error } = await aisha.rpc("fn_get_run_faithfulness", {
        p_run_id: runId,
      });
      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data) || data.length === 0) return null;
      const parsed = FaithfulnessScoreSchema.safeParse(data[0]);
      return parsed.success ? parsed.data : null;
    },
    enabled: !!user && !!runId,
    staleTime: 30_000,
  });
}

export interface SubmitFeedbackArgs {
  aiRunId: string;
  rating: -1 | 0 | 1;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export function useSubmitMessageFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: SubmitFeedbackArgs): Promise<string> => {
      const { data, error } = await aisha.rpc("fn_submit_message_feedback_audited", {
        p_ai_run_id: args.aiRunId,
        p_metadata: (args.metadata ?? {}) as unknown as Json,
        p_rating: args.rating,
        p_reason: args.reason ?? "",
      });
      if (error) throw new Error(error.message);
      return z.string().uuid().parse(data);
    },
    onSuccess: (_id, vars) => {
      queryClient.invalidateQueries({ queryKey: ["run-citations", vars.aiRunId] });
      queryClient.invalidateQueries({ queryKey: ["run-faithfulness", vars.aiRunId] });
    },
    onError: (err) => safeError("useSubmitMessageFeedback.failed", err),
  });
}

/**
 * Map a numeric faithfulness score to a UI severity tier. Used by
 * FaithfulnessChip to pick icon + color (lucide-react).
 *
 *   high   → 0.85+   (ShieldCheck)
 *   medium → 0.60–0.85 (AlertCircle)
 *   low    → <0.60   (XCircle)
 *   noData → null    (HelpCircle)
 */
export function faithfulnessTier(score: number | null | undefined): "high" | "medium" | "low" | "noData" {
  if (score === null || score === undefined) return "noData";
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}
