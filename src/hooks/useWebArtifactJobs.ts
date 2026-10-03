/**
 * useWebArtifactJobs — list the artifact iteration history for a story.
 *
 * Wraps `get_web_artifact_jobs_for_story(p_story_id)` RPC. Returns rows
 * ordered created_at DESC (most recent iteration first). Used by the
 * /admin/stories/:id timeline screen.
 *
 * @module
 */
import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import { webArtifactJobSchema } from "@/lib/schemas/webArtifactSchemas";

const STALE_TIME = 30 * 1000;

export const webArtifactJobsKeys = {
  forStory: (storyId: string) => ["web-artifact-jobs", "story", storyId] as const,
};

export function useWebArtifactJobs(storyId: string | undefined) {
  return useQuery({
    enabled: !!storyId,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_web_artifact_jobs_for_story", {
        p_story_id: storyId!,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(webArtifactJobSchema, data, "get_web_artifact_jobs_for_story");
    },
    queryKey: webArtifactJobsKeys.forStory(storyId ?? ""),
    staleTime: STALE_TIME,
  });
}
