/**
 * useRequestRedesign — mutation: ask Aisha to redesign an existing artifact.
 *
 * Calls `request_web_artifact_redesign(p_job_id, p_brief, p_slot_profile, p_creativity_seed)`.
 * The RPC spawns a NEW job (kind='redesign', source_type='llm_redesign') seeded from
 * the prior job's `result_canvas_data`. Then triggers WF_OCCIPITUM_REDESIGN webhook.
 *
 * @module
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  requestRedesignInputSchema,
  type RequestRedesignInput,
} from "@/lib/schemas/webArtifactSchemas";
import { webArtifactJobsKeys } from "./useWebArtifactJobs";

interface RequestRedesignArgs extends RequestRedesignInput {
  storyId: string;
}

export function useRequestRedesign() {
  const queryClient = useQueryClient();
  return useMutation<{ job_id: string }, Error, RequestRedesignArgs>({
    mutationFn: async (input) => {
      const parsed = requestRedesignInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      const { data, error } = await aisha.rpc("request_web_artifact_redesign", {
        p_brief: parsed.data.brief,
        p_creativity_seed: parsed.data.creativity_seed,
        p_job_id: parsed.data.job_id,
        p_slot_profile: parsed.data.slot_profile,
      });
      if (error) throw new Error(error.message);
      const job_id = typeof data === "string" ? data : String(data);

      try {
        await fetch(`/webhook/web-artifact-redesign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job_id }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        safeError("useRequestRedesign: n8n webhook trigger failed", err);
      }

      return { job_id };
    },
    onSuccess: (_data, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: webArtifactJobsKeys.forStory(storyId) });
    },
  });
}
