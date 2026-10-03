/**
 * Zod schemas for Occipitum design profile and canvas proposals
 *
 * @module lib/schemas/designSchemas
 */

import { z } from "zod";

// ── Brand DNA ────────────────────────────────────────────────

/** Schema for brand personality / DNA extracted from design interview */
export const brandDnaSchema = z.object({
  personality: z.string().optional(),
  tone_of_voice: z.string().optional(),
  values: z.array(z.string()).optional(),
  archetypes: z.array(z.string()).optional(),
  color_associations: z.array(z.string()).optional(),
  typography_mood: z.string().optional(),
});

export type BrandDna = z.infer<typeof brandDnaSchema>;

// ── UX Persona ───────────────────────────────────────────────

/** Schema for target user persona derived from interview */
export const uxPersonaSchema = z.object({
  goals: z.array(z.string()).optional(),
  pain_points: z.array(z.string()).optional(),
  emotional_expectations: z.array(z.string()).optional(),
  tech_savviness: z.string().optional(),
  age_range: z.string().optional(),
});

export type UxPersona = z.infer<typeof uxPersonaSchema>;

// ── Style Preferences ────────────────────────────────────────

/** Schema for visual style preferences */
export const stylePreferencesSchema = z.object({
  liked_styles: z.array(z.string()).optional(),
  disliked_styles: z.array(z.string()).optional(),
  vibe_words: z.array(z.string()).optional(),
  reference_urls: z.array(z.string().url()).optional(),
  layout_preferences: z.string().optional(),
});

export type StylePreferences = z.infer<typeof stylePreferencesSchema>;

// ── Design Constraints ───────────────────────────────────────

/** Schema for technical/business constraints */
export const designConstraintsSchema = z.object({
  accessibility_level: z.enum(["basic", "wcag_aa", "wcag_aaa"]).optional(),
  mobile_first: z.boolean().optional(),
  performance_budget_ms: z.number().optional(),
  must_include_elements: z.array(z.string()).optional(),
  brand_guidelines_url: z.string().url().optional(),
});

export type DesignConstraints = z.infer<typeof designConstraintsSchema>;

// ── Design Profile (full) ────────────────────────────────────

/** Schema for the complete design profile stored in design_profiles table */
export const designProfileSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  brand_dna: brandDnaSchema.nullable(),
  ux_persona: uxPersonaSchema.nullable(),
  style_preferences: stylePreferencesSchema.nullable(),
  design_constraints: designConstraintsSchema.nullable(),
  profile_version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type DesignProfile = z.infer<typeof designProfileSchema>;

/** Schema for the RPC response wrapper from get_design_profile */
export const designProfileRpcResponseSchema = z.object({
  status: z.enum(["ok", "not_found"]),
  profile: designProfileSchema.nullable(),
});

export type DesignProfileRpcResponse = z.infer<typeof designProfileRpcResponseSchema>;

// ── Occipitum Rationale ──────────────────────────────────────

/** Schema for the design reasoning metadata attached to proposals */
export const occipitumRationaleSchema = z.object({
  style_band: z.string(),
  creativity_seed: z.number(),
  patterns_used: z.array(z.string()),
  anti_patterns_avoided: z.array(z.string()),
  design_reasoning: z.string(),
});

export type OccipitumRationale = z.infer<typeof occipitumRationaleSchema>;

// ── Canvas Proposal ──────────────────────────────────────────

/** Schema for a GrapeJS canvas proposal from Occipitum */
export const occipitumProposalSchema = z.object({
  story_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  style_band: z.string(),
  creativity_seed: z.number(),
  rationale: occipitumRationaleSchema,
  project_data: z.object({
    pages: z.array(z.object({
      component: z.string(),
    })),
    styles: z.array(z.record(z.unknown())).optional(),
  }),
});

export type OccipitumProposal = z.infer<typeof occipitumProposalSchema>;

// ── Interview Types ──────────────────────────────────────────

/** Schema for design DNA interview request */
export const designInterviewRequestSchema = z.object({
  partner_id: z.string().uuid(),
  session_id: z.string().optional(),
  answers: z.array(z.object({
    question_id: z.string(),
    answer: z.string(),
  })).optional(),
});

export type DesignInterviewRequest = z.infer<typeof designInterviewRequestSchema>;

/** Schema for design generation request */
export const designGenerationRequestSchema = z.object({
  story_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  page_intent: z.enum(["landing", "about", "services", "contact", "product", "blog"]).optional(),
  existing_canvas: z.record(z.unknown()).nullable().optional(),
});

export type DesignGenerationRequest = z.infer<typeof designGenerationRequestSchema>;
