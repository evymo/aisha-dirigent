/**
 * useAgentLiveSessions — universal live agent-session monitoring.
 *
 * Wraps list_active_agent_sessions RPC with a realtime subscription on
 * agent_live_sessions, so Mission Control's AgentSessionsStrip reflects any
 * reporting surface (Claude Code CLI hooks, VS Code Dirigent extension, Zed,
 * Codex, AISHA-spawned container runs) without polling.
 *
 * Data flow:
 *   relay hook / extension push → fn_upsert_agent_live_session
 *   → agent_live_sessions (realtime) → useAgentLiveSessions → AgentSessionsStrip
 *
 * Token/cost figures come from the ai_trace_events rollup through the
 * session's ide_session ai_run (same canonical numbers finish_ai_run persists).
 *
 * useAgentPhaseCatalog reads the seed-extensible phase taxonomy
 * (agent_phase_catalog) for badge labels — clients keep a static fallback so
 * the strip renders before the catalog loads (or offline).
 *
 * @module hooks/useAgentLiveSessions
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

// ============================================================================
// Schemas
// ============================================================================

const SubagentSchema = z.object({
  label: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
});

const AgentLiveSessionSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  story_id: z.string().uuid().nullable(),
  story_title: z.string().nullable(),
  user_id: z.string().uuid().nullable(),
  agent_run_id: z.string().uuid().nullable(),
  ai_run_id: z.string().uuid().nullable(),
  branch: z.string().nullable(),
  current_phase: z.string(),
  phase_detail: z.string().nullable(),
  current_task: z.string().nullable(),
  last_tool: z.string().nullable(),
  last_file: z.string().nullable(),
  subagents: z.array(SubagentSchema),
  tokens_estimate: z.number().int().nullable(),
  tokens_input: z.number().int(),
  tokens_output: z.number().int(),
  cost: z.number(),
  started_at: z.string(),
  updated_at: z.string(),
  elapsed_ms: z.number().int(),
});

const AgentLiveSessionArraySchema = z.array(AgentLiveSessionSchema);

export type AgentLiveSession = z.infer<typeof AgentLiveSessionSchema>;
export type AgentSubagent = z.infer<typeof SubagentSchema>;

const PhaseCatalogEntrySchema = z.object({
  slug: z.string(),
  axis: z.string(),
  labels: z.record(z.string(), z.string()),
  sort_order: z.number().int(),
});

const PhaseCatalogArraySchema = z.array(PhaseCatalogEntrySchema);

export type AgentPhaseCatalogEntry = z.infer<typeof PhaseCatalogEntrySchema>;

// ============================================================================
// Hooks
// ============================================================================

export function useAgentLiveSessions(
  opts: { limit?: number; source?: string; enabled?: boolean } = {},
) {
  const { limit = 20, source, enabled = true } = opts;
  return useLiveTable<AgentLiveSession>({
    table: "agent_live_sessions",
    queryKey: ["agent_live_sessions", limit, source ?? "all"],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("list_active_agent_sessions", {
        p_limit: limit,
        p_source: source ?? undefined,
      });
      if (error) {
        safeError("useAgentLiveSessions", error);
        throw new Error(error.message);
      }
      const parsed = AgentLiveSessionArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useAgentLiveSessions:parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
}

/**
 * Seed-extensible phase taxonomy for badge labels. Long staleTime — the
 * catalog changes only when AISHA seeds new phases; realtime is unnecessary.
 */
export function useAgentPhaseCatalog(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useQuery({
    queryKey: ["agent_phase_catalog"],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<AgentPhaseCatalogEntry[]> => {
      const { data, error } = await aisha.rpc("get_agent_phase_catalog");
      if (error) {
        safeError("useAgentPhaseCatalog", error);
        throw new Error(error.message);
      }
      const parsed = PhaseCatalogArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useAgentPhaseCatalog:parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
}
