/**
 * Zod schemas for web_artifact_jobs RPC responses + request validation.
 *
 * Used by:
 *   - useWebArtifactJobs (list query)
 *   - useStartIngestUpload / useStartIngestScrape (mutations)
 *   - useRequestRedesign / useApplyArtifact / usePublishArtifact (mutations)
 *
 * The job's `result_canvas_data` is intentionally `z.unknown().nullable()` —
 * shape is GrapesJS ProjectData (validated server-side by complete RPC).
 *
 * @module
 */
import { z } from "zod";

export const webArtifactKindSchema = z.enum(["ingest_upload", "ingest_scrape", "redesign", "apply"]);
export const webArtifactSourceTypeSchema = z.enum([
  "folder_upload",
  "url_scrape",
  "manual",
  "default_seed",
  "llm_redesign",
]);
export const webArtifactJobStatusSchema = z.enum([
  "pending",
  "processing",
  "ready_for_review",
  "approved",
  "applied",
  "rejected",
  "failed",
]);

/** Runtime block suggestion entry — produced by svc-web-artifact detector. */
export const runtimeBlockSuggestionSchema = z.object({
  kind: z.enum(["runtime_block", "preserve_as_static"]),
  element_path: z.string(),
  suggested_block_type: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  data_block_config: z.record(z.unknown()).default({}),
  original_html_snippet: z.string(),
  reason: z.string(),
  suggested_followup_story: z.string().optional(),
});
export type RuntimeBlockSuggestion = z.infer<typeof runtimeBlockSuggestionSchema>;

/** Job row schema — output of get_web_artifact_jobs_for_story. */
export const webArtifactJobSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid().nullable(),
  kind: webArtifactKindSchema,
  source_type: webArtifactSourceTypeSchema,
  status: webArtifactJobStatusSchema,
  source_url: z.string().nullable(),
  source_storage_path: z.string().nullable(),
  brief: z.string().nullable(),
  slot_profile: z.string().nullable(),
  extracted_tokens: z.unknown().nullable(),
  result_canvas_html: z.string().nullable(),
  applied_to_page_id: z.string().uuid().nullable(),
  applied_version_id: z.string().uuid().nullable(),
  error_message: z.string().nullable(),
  metadata: z
    .object({
      runtime_block_suggestions: z.array(runtimeBlockSuggestionSchema).optional(),
      style_band: z.string().optional(),
      mock_mode: z.boolean().optional(),
      source_job_id: z.string().optional(),
      suggested_followup_story: z.string().optional(),
    })
    .passthrough()
    .default({}),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  processed_at: z.string().nullable(),
  applied_at: z.string().nullable(),
});
export type WebArtifactJob = z.infer<typeof webArtifactJobSchema>;

export const startIngestUploadInputSchema = z.object({
  story_id: z.string().uuid(),
  source_storage_path: z.string().min(1),
  idempotency_key: z.string().min(16),
});
export type StartIngestUploadInput = z.infer<typeof startIngestUploadInputSchema>;

export const startIngestScrapeInputSchema = z.object({
  story_id: z.string().uuid(),
  source_url: z.string().url(),
  idempotency_key: z.string().min(16),
});
export type StartIngestScrapeInput = z.infer<typeof startIngestScrapeInputSchema>;

export const requestRedesignInputSchema = z.object({
  job_id: z.string().uuid(),
  brief: z.string().min(1).max(2000),
  slot_profile: z.enum(["budget", "balanced", "maxQuality"]).default("balanced"),
  creativity_seed: z.number().min(0).max(1).default(0.5),
});
export type RequestRedesignInput = z.infer<typeof requestRedesignInputSchema>;

export const applyArtifactInputSchema = z.object({
  job_id: z.string().uuid(),
  page_id: z.string().uuid(),
  publish: z.boolean().default(false),
});
export type ApplyArtifactInput = z.infer<typeof applyArtifactInputSchema>;

export const publishArtifactInputSchema = z.object({
  job_id: z.string().uuid(),
});
export type PublishArtifactInput = z.infer<typeof publishArtifactInputSchema>;
