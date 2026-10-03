import { useMutation, useQueryClient } from "@tanstack/react-query";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

export interface SpawnClaudeRunInput {
  prompt: string;
  storyId?: string | null;
  branch?: string | null;
  baseRef?: string;
  acceptanceCriteria?: string | null;
  /** subscription | local_llm | api_key | auto — dynamic per-run routing. */
  authMode?: "subscription" | "local_llm" | "api_key" | "auto";
}

/**
 * Spawn an AISHA-driven Claude CLI run for a story (Component 4 producer surface).
 * Creates a `queued` agent_runs row via fn_spawn_claude_cli_run (story-scoped spend
 * admission applies); the svc-agent-runner poller picks it up and executes it. The
 * image is intentionally omitted — the runner defaults it from AGENT_CLAUDE_IMAGE.
 */
export function useSpawnClaudeRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SpawnClaudeRunInput): Promise<string> => {
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error("prompt is required");
      const inputs = {
        story_id: input.storyId ?? null,
        prompt,
        branch: input.branch ?? null,
        base_ref: input.baseRef ?? "HEAD",
        acceptance_criteria: input.acceptanceCriteria ?? null,
        auth_mode: input.authMode ?? "auto",
      };
      // Params kept alphabetical (v2 Service RPC contract gate) + explicit keys.
      const { data, error } = await aisha.rpc("fn_spawn_claude_cli_run", {
        p_image: "",
        p_inputs: inputs,
        p_source: "dirigent:ui",
      });
      if (error) {
        safeError("spawn_claude_run failed", error);
        throw error;
      }
      return data as string; // the new run id
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-live-sessions"] });
      void qc.invalidateQueries({ queryKey: ["agent-runs"] });
    },
  });
}
