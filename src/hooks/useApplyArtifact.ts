/**
 * useApplyArtifact — mutation: apply a ready_for_review job's canvas to a web_pages row.
 *
 * Wraps `apply_web_artifact_to_page(p_job_id, p_page_id, p_publish)`.
 *
 * The RPC enforces the concurrency guard internally and creates a pre-apply
 * version snapshot, so the UI just needs to dispatch the call and surface
 * the `stale_artifact_apply_another_version_landed` exception if it happens.
 *
 * @module
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import {
  applyArtifactInputSchema,
  type ApplyArtifactInput,
} from "@/lib/schemas/webArtifactSchemas";
import { webArtifactJobsKeys } from "./useWebArtifactJobs";

interface ApplyArtifactArgs extends ApplyArtifactInput {
  storyId: string;
}

export function useApplyArtifact() {
  const queryClient = useQueryClient();
  return useMutation<{ pre_apply_version_id: string }, Error, ApplyArtifactArgs>({
    mutationFn: async (input) => {
      const parsed = applyArtifactInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      const { data, error } = await aisha.rpc("apply_web_artifact_to_page", {
        p_job_id: parsed.data.job_id,
        p_page_id: parsed.data.page_id,
        p_publish: parsed.data.publish,
      });
      if (error) throw new Error(error.message);
      const pre_apply_version_id = typeof data === "string" ? data : String(data);
      return { pre_apply_version_id };
    },
    onSuccess: (_data, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: webArtifactJobsKeys.forStory(storyId) });
      queryClient.invalidateQueries({ queryKey: ["admin-web-pages"] });
      queryClient.invalidateQueries({ queryKey: ["web-page"] });
    },
  });
}
