/**
 * useStartIngestScrape — mutation: trigger URL scrape ingest pipeline.
 *
 * Calls `start_web_artifact_ingest(kind='ingest_scrape', source_type='url_scrape', source_url)`
 * then triggers the n8n webhook to drive parsing.
 *
 * @module
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { webArtifactJobsKeys } from "./useWebArtifactJobs";

interface StartIngestScrapeArgs {
  storyId: string;
  sourceUrl: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useStartIngestScrape() {
  const queryClient = useQueryClient();
  return useMutation<{ job_id: string }, Error, StartIngestScrapeArgs>({
    mutationFn: async ({ storyId, sourceUrl }) => {
      const idempotencyKey = await sha256Hex(`url_scrape|${sourceUrl}|${storyId}|${Date.now() / 60000 | 0}`);

      const { data, error } = await aisha.rpc("start_web_artifact_ingest", {
        p_idempotency_key: idempotencyKey,
        p_kind: "ingest_scrape",
        p_metadata: {},
        p_source_storage_path: undefined,
        p_source_type: "url_scrape",
        p_source_url: sourceUrl,
        p_story_id: storyId,
      });
      if (error) throw new Error(error.message);
      const job_id = typeof data === "string" ? data : String(data);

      try {
        await fetch(`/webhook/web-artifact-ingest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            story_id: storyId,
            source_type: "url_scrape",
            source_url: sourceUrl,
            idempotency_key: idempotencyKey,
            kind: "ingest_scrape",
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        safeError("useStartIngestScrape: n8n webhook trigger failed", err);
      }

      return { job_id };
    },
    onSuccess: (_data, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: webArtifactJobsKeys.forStory(storyId) });
    },
  });
}
