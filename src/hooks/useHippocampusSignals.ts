/**
 * useHippocampusSignals + reveal + governance — Phase 6 hippocampus
 * surface hooks. All wrap the three new RPCs introduced by
 * 20260520300000_hippocampus_rpcs migration.
 *
 * Realtime via useLiveTable (agent_memories INSERT) — new signals show
 * up in the UI within seconds of AISHA capturing them.
 *
 * @module hooks/useHippocampusSignals
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

// ============================================================================
// Schemas
// ============================================================================

const SignalRowSchema = z.object({
  memory_id: z.string().uuid(),
  agent_slug: z.string(),
  memory_type: z.string(),
  importance: z.number().int(),
  content_preview: z.string(),
  preview_truncated: z.boolean(),
  expires_at: z.string().nullable(),
  source_run_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const SignalArraySchema = z.array(SignalRowSchema);

const RevealRowSchema = z.object({
  memory_id: z.string().uuid(),
  agent_slug: z.string(),
  memory_type: z.string(),
  content: z.string(),
  importance: z.number().int(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export type HippocampusSignal = z.infer<typeof SignalRowSchema>;
export type HippocampusReveal = z.infer<typeof RevealRowSchema>;

// ============================================================================
// List hook (live)
// ============================================================================

interface UseHippocampusSignalsOptions {
  storyId: string | null | undefined;
  agentSlug?: string | null;
  enabled?: boolean;
}

export function useHippocampusSignals(opts: UseHippocampusSignalsOptions) {
  const { storyId, agentSlug = null, enabled = true } = opts;

  return useLiveTable<HippocampusSignal>({
    table: "agent_memories",
    queryKey: ["hippocampus_signals", storyId, agentSlug],
    enabled: enabled && !!storyId,
    rpc: async () => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("list_hippocampus_signals", {
        p_agent_slug: agentSlug ?? undefined,
        p_story_id: storyId,
      });
      if (error) {
        safeError("useHippocampusSignals", error);
        throw error;
      }
      return SignalArraySchema.parse(data ?? []);
    },
  });
}

// ============================================================================
// Reveal mutation
// ============================================================================

interface RevealInput {
  memoryId: string;
  reason?: string | null;
}

export function useRevealHippocampusContent() {
  return useMutation({
    mutationFn: async (input: RevealInput): Promise<HippocampusReveal | null> => {
      const { data, error } = await aisha.rpc(
        "reveal_hippocampus_content_audited",
        {
          p_memory_id: input.memoryId,
          p_reason: input.reason ?? undefined,
        },
      );
      if (error) {
        safeError("useRevealHippocampusContent", error);
        throw error;
      }
      const rows = z.array(RevealRowSchema).parse(data ?? []);
      return rows[0] ?? null;
    },
  });
}

// ============================================================================
// Governance mutation (promote / forget / suspend)
// ============================================================================

interface GovernanceInput {
  memoryId: string;
  mode: "promote" | "forget" | "suspend";
  reason?: string | null;
}

export function useSetMemoryGovernance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GovernanceInput) => {
      const { data, error } = await aisha.rpc(
        "set_memory_governance_audited",
        {
          p_memory_id: input.memoryId,
          p_mode: input.mode,
          p_reason: input.reason ?? undefined,
        },
      );
      if (error) {
        safeError("useSetMemoryGovernance", error);
        throw error;
      }
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hippocampus_signals"] });
    },
  });
}
