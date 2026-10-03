/**
 * Gate tests — Occipitum Design System Integrity
 *
 * Validates structural integrity of the Occipitum visual cortex subsystem:
 * - DB migration schema elements (table, functions, RLS, agent_catalog)
 * - SoT files match migration
 * - Zod schemas match DB structure
 * - Hook ↔ RPC param alignment
 * - n8n workflow references valid functions and correct channel names
 * - UI component wiring (partnerId prop, Realtime channel, imports)
 * - i18n keys completeness
 * - KB seed integrity
 *
 * Runs in Vitest node environment (no DOM needed).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// =============================================================================
// File paths
// =============================================================================

const MIGRATION_PATH = resolve(
  "aisha/db/migrations/00000000000000_baseline.sql",
);
const SOT_TABLE_PATH = resolve("aisha/db/sql/tables/design_profiles.sql");
const SOT_FN_GET_PATH = resolve("aisha/db/sql/functions/get_design_profile.sql");
const SOT_FN_UPSERT_PATH = resolve("aisha/db/sql/functions/upsert_design_profile.sql");
const SOT_POLICY_PATHS = [
  resolve("aisha/db/sql/policies/design_profiles_partner_select.sql"),
  resolve("aisha/db/sql/policies/design_profiles_partner_insert.sql"),
  resolve("aisha/db/sql/policies/design_profiles_partner_update.sql"),
  resolve("aisha/db/sql/policies/design_profiles_admin_all.sql"),
  resolve("aisha/db/sql/policies/design_profiles_service_all.sql"),
];
const SCHEMA_PATH = resolve("src/lib/schemas/designSchemas.ts");
const HOOK_PATH = resolve("src/hooks/useDesignProfile.ts");
const HOOK_BARREL_PATH = resolve("src/hooks/index.ts");
const PANEL_PATH = resolve("src/components/storyloop/OccipitumDesignPanel.tsx");
const INTERVIEW_PATH = resolve("src/components/storyloop/DesignDNAInterviewSheet.tsx");
const CANVAS_BUILDER_PATH = resolve("src/components/storyloop/StoryCanvasBuilder.tsx");
const STORY_DETAIL_PATH = resolve("src/components/storyloop/StoryDetail.tsx");
const AGENT_STREAM_PATH = resolve("src/components/storyloop/AgentActivityStream.tsx");
const N8N_DESIGN_PATH = resolve("n8n/workflows/WF_OCCIPITUM_DESIGN.json");
const N8N_INTERVIEW_PATH = resolve("n8n/workflows/WF_DESIGN_DNA_INTERVIEW.json");
const KB_SEED_PATH = resolve("aisha/db/seed/core/30_occipitum_design_kb.sql");
const I18N_EN_PARTNER = resolve("src/i18n/segments/en/partner.json");
const I18N_CS_PARTNER = resolve("src/i18n/segments/cs/partner.json");

// =============================================================================
// Load files
// =============================================================================

function safeRead(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

const migration = safeRead(MIGRATION_PATH);
const sotTable = safeRead(SOT_TABLE_PATH);
const sotFnGet = safeRead(SOT_FN_GET_PATH);
const sotFnUpsert = safeRead(SOT_FN_UPSERT_PATH);
const sotPolicies = SOT_POLICY_PATHS.map((p) => safeRead(p)).join("\n");
const schemas = safeRead(SCHEMA_PATH);
const hook = safeRead(HOOK_PATH);
const hookBarrel = safeRead(HOOK_BARREL_PATH);
const panel = safeRead(PANEL_PATH);
const interview = safeRead(INTERVIEW_PATH);
const canvasBuilder = safeRead(CANVAS_BUILDER_PATH);
const storyDetail = safeRead(STORY_DETAIL_PATH);
const agentStream = safeRead(AGENT_STREAM_PATH);
const n8nDesign = safeRead(N8N_DESIGN_PATH);
const n8nInterview = safeRead(N8N_INTERVIEW_PATH);
const kbSeed = safeRead(KB_SEED_PATH);
const i18nEn = safeRead(I18N_EN_PARTNER);
const i18nCs = safeRead(I18N_CS_PARTNER);

// =============================================================================
// 1. DB Migration — schema integrity
// =============================================================================

describe("occipitum migration — schema integrity", () => {
  it("migration file exists and is non-empty", () => {
    expect(migration.length).toBeGreaterThan(500);
  });

  it("creates design_profiles table with correct columns", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.design_profiles");
    expect(migration).toContain("partner_id uuid NOT NULL");
    expect(migration).toContain("brand_dna jsonb");
    expect(migration).toContain("ux_persona jsonb");
    expect(migration).toContain("style_preferences jsonb");
    expect(migration).toContain("design_constraints jsonb");
    expect(migration).toContain("profile_version integer");
  });

  it("creates unique index on partner_id", () => {
    expect(migration).toContain("idx_design_profiles_partner");
    expect(migration).toContain("ON public.design_profiles (partner_id)");
  });

  it("enables RLS", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("creates 5 RLS policies", () => {
    expect(migration).toContain("design_profiles_partner_select");
    expect(migration).toContain("design_profiles_partner_insert");
    expect(migration).toContain("design_profiles_partner_update");
    expect(migration).toContain("design_profiles_admin_all");
    expect(migration).toContain("design_profiles_service_all");
  });

  it("creates get_design_profile RPC (SECURITY INVOKER)", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_design_profile");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("p_partner_id uuid");
  });

  it("upsert_design_profile RPC is SECURITY DEFINER with REVOKE/GRANT (canonical SoT)", () => {
    const fn = safeRead(SOT_FN_UPSERT_PATH);
    expect(fn).toContain("CREATE OR REPLACE FUNCTION public.upsert_design_profile");
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/REVOKE ALL ON FUNCTION (public\.)?upsert_design_profile[\s\S]*FROM PUBLIC/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION (public\.)?upsert_design_profile[\s\S]*TO authenticated/);
  });

  it("upsert function logs to audit_journal", () => {
    expect(migration).toContain("INSERT INTO public.audit_journal");
    expect(migration).toContain("DESIGN_PROFILE_UPSERT");
  });

  it("agent_catalog mechanism + occipitum design KB exist in SoT", () => {
    // The agent_catalog TABLE is the platform mechanism; occipitum's design data
    // lives in its KB seed (30_occipitum_design_kb.sql). The specific occipitum
    // agent_catalog registration ROW is implementation seed (→ example), not a
    // platform-core fixture — so assert the mechanism + the occipitum KB here.
    expect(existsSync(resolve("aisha/db/sql/tables/agent_catalog.sql"))).toBe(true);
    expect(existsSync(KB_SEED_PATH)).toBe(true);
  });

  it("creates updated_at trigger", () => {
    expect(migration).toContain("trg_design_profiles_updated_at");
  });
});

// =============================================================================
// 2. SoT files — consistency with migration
// =============================================================================

describe("occipitum SoT files — consistency", () => {
  it("SoT table file exists and matches migration structure", () => {
    expect(sotTable).toContain("CREATE TABLE IF NOT EXISTS public.design_profiles");
    expect(sotTable).toContain("partner_id uuid NOT NULL");
    expect(sotTable).toContain("brand_dna jsonb");
    expect(sotTable).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("SoT get_design_profile function matches migration", () => {
    expect(sotFnGet).toContain("get_design_profile");
    expect(sotFnGet).toContain("p_partner_id uuid");
    expect(sotFnGet).toContain("SECURITY INVOKER");
    expect(sotFnGet).toContain("jsonb_build_object");
  });

  it("SoT upsert_design_profile function matches migration", () => {
    expect(sotFnUpsert).toContain("upsert_design_profile");
    expect(sotFnUpsert).toContain("SECURITY DEFINER");
    expect(sotFnUpsert).toContain("audit_journal");
    expect(sotFnUpsert).toContain("REVOKE ALL");
  });

  it("SoT policies files have all 5 policies", () => {
    expect(sotPolicies).toContain("design_profiles_partner_select");
    expect(sotPolicies).toContain("design_profiles_partner_insert");
    expect(sotPolicies).toContain("design_profiles_partner_update");
    expect(sotPolicies).toContain("design_profiles_admin_all");
    expect(sotPolicies).toContain("design_profiles_service_all");
  });
});

// =============================================================================
// 3. Zod schemas — completeness
// =============================================================================

describe("occipitum Zod schemas — completeness", () => {
  it("exports all required schemas", () => {
    expect(schemas).toContain("export const brandDnaSchema");
    expect(schemas).toContain("export const uxPersonaSchema");
    expect(schemas).toContain("export const stylePreferencesSchema");
    expect(schemas).toContain("export const designConstraintsSchema");
    expect(schemas).toContain("export const designProfileSchema");
    expect(schemas).toContain("export const designProfileRpcResponseSchema");
    expect(schemas).toContain("export const occipitumRationaleSchema");
    expect(schemas).toContain("export const occipitumProposalSchema");
  });

  it("designProfileSchema has all DB columns", () => {
    expect(schemas).toMatch(/id:\s*z\.string\(\)\.uuid/);
    expect(schemas).toMatch(/partner_id:\s*z\.string\(\)\.uuid/);
    expect(schemas).toMatch(/brand_dna:/);
    expect(schemas).toMatch(/ux_persona:/);
    expect(schemas).toMatch(/style_preferences:/);
    expect(schemas).toMatch(/design_constraints:/);
    expect(schemas).toMatch(/profile_version:\s*z\.number/);
  });

  it("RPC response schema has status enum", () => {
    expect(schemas).toContain('z.enum(["ok", "not_found"])');
  });

  it("exports type inferences", () => {
    expect(schemas).toContain("export type BrandDna");
    expect(schemas).toContain("export type DesignProfile");
    expect(schemas).toContain("export type OccipitumProposal");
  });
});

// =============================================================================
// 4. Hooks — RPC alignment
// =============================================================================

describe("occipitum hooks — RPC alignment", () => {
  it("useDesignProfile calls get_design_profile with correct param", () => {
    expect(hook).toContain('aisha.rpc("get_design_profile"');
    expect(hook).toContain("p_partner_id: partnerId");
  });

  it("useDesignProfile uses Zod validation", () => {
    expect(hook).toContain("designProfileRpcResponseSchema.parse(data)");
  });

  it("useDesignInterview calls n8n webhook", () => {
    expect(hook).toContain("VITE_N8N_WEBHOOK_URL");
    expect(hook).toContain("/design-dna-interview");
  });

  it("useOccipitumDesign calls n8n webhook and validates response", () => {
    expect(hook).toContain("/occipitum-design");
    expect(hook).toContain("occipitumProposalSchema.parse(json)");
  });

  it("all 3 hooks are barrel-exported", () => {
    expect(hookBarrel).toContain("useDesignProfile");
    expect(hookBarrel).toContain("useDesignInterview");
    expect(hookBarrel).toContain("useOccipitumDesign");
  });

  it("hooks use safeError for error logging", () => {
    expect(hook).toContain('safeError("design.');
    expect(hook).not.toContain("console.log");
    expect(hook).not.toContain("console.error");
  });

  it("hooks use auth token from session", () => {
    // v2: KC OIDC session via getKcSession / getSession from oidc-client
    expect(hook).toMatch(/get(?:Kc)?Session/);
    expect(hook).toContain("access_token");
  });
});

// =============================================================================
// 5. UI — component wiring
// =============================================================================

describe("occipitum UI — component wiring", () => {
  it("StoryCanvasBuilder accepts partnerId prop", () => {
    expect(canvasBuilder).toContain("partnerId?: string");
  });

  it("StoryCanvasBuilder imports Occipitum components", () => {
    expect(canvasBuilder).toContain("DesignDNAInterviewSheet");
    expect(canvasBuilder).toContain("OccipitumDesignPanel");
  });

  it("StoryCanvasBuilder conditionally renders on partnerId", () => {
    expect(canvasBuilder).toContain("{partnerId && (");
  });

  it("StoryDetail passes partnerId to LazyStoryCanvasBuilder", () => {
    expect(storyDetail).toContain("partnerId={story.partner_id}");
  });

  it("AgentActivityStream handles occipitum_proposal event", () => {
    expect(agentStream).toContain("occipitum_proposal");
  });

  it("OccipitumDesignPanel uses safeError, not console", () => {
    expect(panel).toContain('safeError("design.');
    expect(panel).not.toContain("console.log");
    expect(panel).not.toContain("console.error");
  });

  it("DesignDNAInterviewSheet uses safeError, not console", () => {
    expect(interview).toContain('safeError("design.');
    expect(interview).not.toContain("console.log");
  });

  it("OccipitumDesignPanel uses useTranslation for all UI text", () => {
    expect(panel).toContain('const { t } = useTranslation()');
    // No hardcoded string elements — all should use t()
    expect(panel).not.toMatch(/<Button[^>]*>[A-Z][a-z]+<\/Button>/);
  });
});

// =============================================================================
// 6. Realtime channel — consistency
// =============================================================================

describe("occipitum Realtime channel — consistency", () => {
  it("StoryCanvasBuilder subscribes to correct channel pattern", () => {
    // Must match the n8n broadcast topic
    expect(canvasBuilder).toContain("`story:${storyId}:canvas`");
    // Must NOT have the old :proposals suffix
    expect(canvasBuilder).not.toContain("`story:${storyId}:canvas:proposals`");
  });

  it("n8n design workflow broadcasts to matching channel", () => {
    expect(n8nDesign).toContain("story:${story_id}:canvas");
    expect(n8nDesign).toContain("agent_activity");
    expect(n8nDesign).toContain("occipitum_proposal");
  });

  it("StoryCanvasBuilder listens for agent_activity event", () => {
    expect(canvasBuilder).toContain('"agent_activity"');
  });

  it("StoryCanvasBuilder checks occipitum_proposal type", () => {
    expect(canvasBuilder).toContain('data.type === "occipitum_proposal"');
  });
});

// =============================================================================
// 7. Personality signal — user_id correctness
// =============================================================================

describe("occipitum personality signals — user_id correctness", () => {
  it("OccipitumDesignPanel uses auth user ID, not partnerId", () => {
    // v2: KC OIDC user via getKcUser / getUser from oidc-client
    expect(panel).toMatch(/get(?:Kc)?User/);
    expect(panel).toContain("p_user_id: user.id");
    // Must NOT pass partnerId as p_user_id
    expect(panel).not.toContain("p_user_id: partnerId");
  });

  it("n8n workflow resolves partner_id to user_id before signal", () => {
    // Must lookup user_id from partner_profiles
    expect(n8nDesign).toContain("partner_profiles");
    expect(n8nDesign).toContain("select=user_id");
    expect(n8nDesign).toContain("p_user_id: userId");
    // Must NOT pass partner_id directly as p_user_id
    expect(n8nDesign).not.toMatch(/p_user_id:\s*partner_id/);
  });
});

// =============================================================================
// 8. n8n workflows — structural integrity
// =============================================================================

describe("occipitum n8n workflows — structural integrity", () => {
  it("design workflow has all required nodes", () => {
    expect(n8nDesign).toContain("Occipitum Design Webhook");
    expect(n8nDesign).toContain("Validate Input");
    expect(n8nDesign).toContain("Load Design Profile");
    expect(n8nDesign).toContain("Parse Canvas Output");
    expect(n8nDesign).toContain("Store Hippocampus Signal");
    expect(n8nDesign).toContain("Broadcast to Canvas");
  });

  it("interview workflow has all required nodes", () => {
    expect(n8nInterview).toContain("Design DNA Interview Webhook");
    expect(n8nInterview).toContain("Upsert Design Profile");
  });

  it("design workflow uses correct webhook path", () => {
    expect(n8nDesign).toContain('"path": "occipitum-design"');
  });

  it("interview workflow uses correct webhook path", () => {
    expect(n8nInterview).toContain('"path": "design-dna-interview"');
  });

  it("design workflow broadcasts via Realtime HTTP API", () => {
    expect(n8nDesign).toContain("/realtime/v1/api/broadcast");
  });

  it("workflows reference only existing RPC functions", () => {
    // fn_capture_personality_signal exists in DB
    expect(n8nDesign).toContain("fn_capture_personality_signal");
    // Must NOT reference non-existent functions
    expect(n8nDesign).not.toContain("fn_insert_personality_signal");
    expect(n8nDesign).not.toContain("fn_broadcast_canvas_event");
  });
});

// =============================================================================
// 9. i18n — key completeness
// =============================================================================

describe("occipitum i18n — key completeness", () => {
  let enKeys: Record<string, unknown> = {};
  let csKeys: Record<string, unknown> = {};

  try {
    enKeys = JSON.parse(i18nEn);
    csKeys = JSON.parse(i18nCs);
  } catch {
    // Will be caught by the file existence test
  }

  const enDesign = (enKeys as Record<string, Record<string, unknown>>).design ?? {};
  const csDesign = (csKeys as Record<string, Record<string, unknown>>).design ?? {};

  it("EN builder.json contains design.interview keys", () => {
    const interview = enDesign.interview as Record<string, unknown> | undefined;
    expect(interview).toBeDefined();
    expect(interview?.trigger).toBeDefined();
    expect(interview?.title).toBeDefined();
    expect(interview?.welcomeQuestion).toBeDefined();
  });

  it("EN builder.json contains design.occipitum keys", () => {
    const occipitum = enDesign.occipitum as Record<string, unknown> | undefined;
    expect(occipitum).toBeDefined();
    expect(occipitum?.trigger).toBeDefined();
    expect(occipitum?.generate).toBeDefined();
    expect(occipitum?.accept).toBeDefined();
    expect(occipitum?.proposalReady).toBeDefined();
  });

  it("CS builder.json contains matching design keys", () => {
    const csInterview = csDesign.interview as Record<string, unknown> | undefined;
    const csOccipitum = csDesign.occipitum as Record<string, unknown> | undefined;
    expect(csInterview).toBeDefined();
    expect(csOccipitum).toBeDefined();
  });
});

// =============================================================================
// 10. KB Seed — structural integrity
// =============================================================================

describe("occipitum KB seed — integrity", () => {
  it("seed file exists and is non-empty", () => {
    expect(kbSeed.length).toBeGreaterThan(200);
  });

  it("contains design patterns", () => {
    expect(kbSeed).toContain("knowledge_items");
    expect(kbSeed).toContain("occipitum");
  });

  it("contains anti-patterns", () => {
    // Anti-patterns are identified by their title prefix "ANTIPATTERN:"
    // (item_type was migrated from design_antipattern to playbook — valid enum value)
    expect(kbSeed).toContain("ANTIPATTERN:");
  });

  it("has no SQL syntax issues (balanced quotes)", () => {
    // Count single quotes — should be even
    const singleQuotes = (kbSeed.match(/'/g) ?? []).length;
    expect(singleQuotes % 2).toBe(0);
  });
});
