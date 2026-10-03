/**
 * usePublishArtifact — mutation: flip the applied page status to 'published'.
 *
 * Wraps `publish_web_artifact(p_job_id)`. Returns the slug of the now-public
 * page (e.g. 'index'), which the UI can deep-link into.
 *
 * @module
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { publishArtifactInputSchema, type PublishArtifactInput } from "@/lib/schemas/webArtifactSchemas";
import { webArtifactJobsKeys } from "./useWebArtifactJobs";

interface PublishArtifactArgs extends PublishArtifactInput {
  storyId: string;
}

export function usePublishArtifact() {
  const queryClient = useQueryClient();
  return useMutation<{ slug: string }, Error, PublishArtifactArgs>({
    mutationFn: async (input) => {
      const parsed = publishArtifactInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      const { data, error } = await aisha.rpc("publish_web_artifact", {
        p_job_id: parsed.data.job_id,
      });
      if (error) throw new Error(error.message);
      const slug = typeof data === "string" ? data : String(data);
      return { slug };
    },
    onSuccess: (_data, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: webArtifactJobsKeys.forStory(storyId) });
      queryClient.invalidateQueries({ queryKey: ["admin-web-pages"] });
      queryClient.invalidateQueries({ queryKey: ["web-page"] });
    },
  });
}
