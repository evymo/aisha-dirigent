/**
 * useStartIngestUpload — mutation that:
 *   1. uploads a zip to `web-artifact-sources` bucket
 *   2. calls `start_web_artifact_ingest` RPC
 *   3. invokes WF_WEB_ARTIFACT_INGEST webhook
 *   4. invalidates the story's job list cache
 *
 * Caller passes `{ storyId, file }`; idempotency key is derived from the
 * file content hash + story id so the same file can be retried safely.
 *
 * @module
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { webArtifactJobsKeys } from "./useWebArtifactJobs";

interface StartIngestUploadArgs {
  storyId: string;
  file: File;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BUCKET = "web-artifact-sources";

export function useStartIngestUpload() {
  const queryClient = useQueryClient();
  return useMutation<{ job_id: string; storage_path: string }, Error, StartIngestUploadArgs>({
    mutationFn: async ({ storyId, file }) => {
      const bytes = await file.arrayBuffer();
      const contentHash = await sha256Hex(bytes);
      const storagePath = `stories/${storyId}/${contentHash}.zip`;
      const idempotencyKey = await sha256Hex(new TextEncoder().encode(`folder_upload|${storagePath}|${storyId}`).buffer);

      const uploadRes = await aisha.storage.from(BUCKET).upload(storagePath, file, {
        contentType: file.type || "application/zip",
        upsert: true,
      });
      if (uploadRes.error) throw new Error(uploadRes.error.message);

      const { data, error } = await aisha.rpc("start_web_artifact_ingest", {
        p_idempotency_key: idempotencyKey,
        p_kind: "ingest_upload",
        p_metadata: {},
        p_source_storage_path: `${BUCKET}/${storagePath}`,
        p_source_type: "folder_upload",
        p_source_url: undefined,
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
            source_type: "folder_upload",
            source_storage_path: `${BUCKET}/${storagePath}`,
            idempotency_key: idempotencyKey,
            kind: "ingest_upload",
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        safeError("useStartIngestUpload: n8n webhook trigger failed", err);
      }

      return { job_id, storage_path: `${BUCKET}/${storagePath}` };
    },
    onSuccess: (_data, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: webArtifactJobsKeys.forStory(storyId) });
    },
  });
}
