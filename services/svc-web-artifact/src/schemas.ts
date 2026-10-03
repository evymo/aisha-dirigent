/**
 * Zod schemas — input/output validation for svc-web-artifact.
 *
 * ProjectDataSchema mirrors a minimal subset of GrapesJS ProjectData
 * with `.passthrough()` so the editor's private fields survive a round-trip.
 */
import { z } from 'zod';

export const ProjectDataSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            component: z.union([z.string(), z.record(z.unknown())]).optional(),
            frame: z.object({ x: z.number(), y: z.number() }).partial().optional(),
          })
          .passthrough(),
      )
      .min(1, 'at least one page required'),
    styles: z
      .array(
        z
          .object({
            selectors: z.array(z.union([z.string(), z.record(z.unknown())])).default([]),
            style: z.record(z.string()).default({}),
          })
          .passthrough(),
      )
      .default([]),
    assets: z
      .array(
        z
          .object({
            src: z.string(),
            type: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type ProjectData = z.infer<typeof ProjectDataSchema>;

export const ExtractedTokensSchema = z
  .object({
    colors: z.record(z.string()).default({}),
    fonts: z.record(z.string()).default({}),
    spacing: z.record(z.string()).default({}),
    other: z.record(z.string()).default({}),
  })
  .passthrough();
export type ExtractedTokens = z.infer<typeof ExtractedTokensSchema>;

/** Heuristic suggestion: which static element could be swapped for a runtime block placeholder. */
export const RuntimeBlockSuggestionSchema = z.object({
  kind: z.enum(['runtime_block', 'preserve_as_static']),
  element_path: z.string(),
  suggested_block_type: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  data_block_config: z.record(z.unknown()).default({}),
  original_html_snippet: z.string(),
  reason: z.string(),
  suggested_followup_story: z.string().optional(),
});
export type RuntimeBlockSuggestion = z.infer<typeof RuntimeBlockSuggestionSchema>;

export const IngestRequestSchema = z.object({
  job_id: z.string().uuid(),
  source_type: z.enum(['folder_upload', 'url_scrape', 'manual', 'default_seed', 'llm_redesign']),
  source_storage_path: z.string().nullable().optional(),
  source_url: z.string().url().nullable().optional(),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const SeedDefaultRequestSchema = z
  .object({
    /** Override the source folder name under domains/templates/ (special value
     *  "default" → domains/default/). When omitted, resolved by the
     *  AISHA_SEED_DOMAIN (folder-name == domain) convention. */
    source_dir: z.string().max(255).optional(),
    target_slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric + hyphens')
      .max(100)
      .default('index'),
    force: z.boolean().default(false),
  })
  .default({ target_slug: 'index', force: false });
export type SeedDefaultRequest = z.infer<typeof SeedDefaultRequestSchema>;

export const ParseResultSchema = z.object({
  canvas_data: ProjectDataSchema,
  canvas_html: z.string(),
  canvas_css: z.string(),
  extracted_tokens: ExtractedTokensSchema,
  runtime_block_suggestions: z.array(RuntimeBlockSuggestionSchema).default([]),
  i18n_keys_used: z.array(z.string()).default([]),
  broken_assets: z.array(z.string()).default([]),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;
