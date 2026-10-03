/**
 * Gate tests — Psyché Personality Module Integrity
 *
 * Validates the structural integrity of the Psyché brain module:
 * - Migration adds immutability trigger + fn_get_psyche_traits RPC
 * - compose_context has psyche_context layer
 * - context_profiles include psyche_context in priority_order
 * - Psyché traits are protected (immutable DNA)
 * - TAO and Psyché are cleanly separated (no overlap)
 *
 * Brain Module Map:
 *   TAO (governance_context) — WHY she exists, philosophical foundation
 *   Psyché (psyche_context) — WHO she IS, character DNA, behavioral patterns
 *   Hippocampus — HOW she adapts, experiential per-user personality evolution
 *   Occipitum — WHAT she sees, visual cortex, design patterns
 *
 * Runs in Vitest node environment (no DOM needed).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// =============================================================================
// File paths
// =============================================================================

// The personality-module migration was absorbed into the baseline; its DDL
// (functions, immutability trigger, compose_context + context_profiles wiring)
// is all compiled there. Assert against the canonical baseline.
const PSYCHE_BASELINE = resolve(
  "aisha/db/migrations/00000000000000_baseline.sql",
);
const PERSONALITY_SEED_PATH = resolve(
  "aisha/db/seed/core/24_aisha_personality.sql",
);
const TAO_SEED_PATH = resolve("aisha/db/seed/core/25_aisha_tao.sql");
const COMPOSE_CONTEXT_PATH = resolve(
  "aisha/db/sql/functions/compose_context.sql",
);
const BACKBONE_SEED_PATH = resolve(
  "aisha/db/seed/core/20_aisha_backbone.sql",
);

const psycheMigrationContent = existsSync(PSYCHE_BASELINE)
  ? readFileSync(PSYCHE_BASELINE, "utf-8")
  : "";
const personalitySeedContent = existsSync(PERSONALITY_SEED_PATH)
  ? readFileSync(PERSONALITY_SEED_PATH, "utf-8")
  : "";
const taoSeedContent = existsSync(TAO_SEED_PATH)
  ? readFileSync(TAO_SEED_PATH, "utf-8")
  : "";
const composeContextContent = existsSync(COMPOSE_CONTEXT_PATH)
  ? readFileSync(COMPOSE_CONTEXT_PATH, "utf-8")
  : "";
const backboneSeedContent = existsSync(BACKBONE_SEED_PATH)
  ? readFileSync(BACKBONE_SEED_PATH, "utf-8")
  : "";

// =============================================================================
// Migration — schema integrity
// =============================================================================

describe("psyché migration — schema integrity", () => {
  it("migration file exists and is non-empty", () => {
    expect(psycheMigrationContent.length).toBeGreaterThan(500);
  });

  it("creates immutability trigger fn_protect_psyche_traits", () => {
    expect(psycheMigrationContent).toContain("fn_protect_psyche_traits");
    expect(psycheMigrationContent).toContain("TRIGGER");
    // Canonical SoT trigger DDL orders the events DELETE-then-UPDATE.
    expect(psycheMigrationContent).toContain("BEFORE DELETE OR UPDATE");
  });

  it("immutability trigger raises exception on personality_trait modification", () => {
    expect(psycheMigrationContent).toContain("RAISE EXCEPTION");
    expect(psycheMigrationContent).toContain("immutable");
    expect(psycheMigrationContent).toContain("personality_trait");
  });

  it("creates fn_get_psyche_traits RPC", () => {
    expect(psycheMigrationContent).toContain("fn_get_psyche_traits");
    expect(psycheMigrationContent).toContain("RETURNS jsonb");
  });

  it("fn_get_psyche_traits uses SECURITY DEFINER", () => {
    const fnBlock = psycheMigrationContent.slice(
      psycheMigrationContent.indexOf("fn_get_psyche_traits"),
    );
    expect(fnBlock).toContain("SECURITY DEFINER");
    expect(fnBlock).toContain("SET search_path TO 'public'");
  });

  it("fn_get_psyche_traits has proper permissions", () => {
    expect(psycheMigrationContent).toContain(
      "REVOKE ALL ON FUNCTION fn_get_psyche_traits",
    );
    expect(psycheMigrationContent).toContain(
      "GRANT EXECUTE ON FUNCTION fn_get_psyche_traits",
    );
  });

  it("fn_get_psyche_traits filters on item_type = personality_trait", () => {
    const fnBlock = psycheMigrationContent.slice(
      psycheMigrationContent.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_get_psyche_traits",
      ),
    );
    expect(fnBlock).toContain("item_type = 'personality_trait'");
  });

  it("fn_get_psyche_traits includes cluster classification", () => {
    expect(psycheMigrationContent).toContain("core_identity");
    expect(psycheMigrationContent).toContain("response_style");
    expect(psycheMigrationContent).toContain("guardrail");
    expect(psycheMigrationContent).toContain("emotional_intelligence");
  });
});

// =============================================================================
// compose_context — psyche_context layer integration
// =============================================================================

describe("compose_context — psyche_context layer", () => {
  it("compose_context declares v_psyche_ctx variable", () => {
    expect(composeContextContent).toContain("v_psyche_ctx");
  });

  it("compose_context handles psyche_context layer", () => {
    expect(composeContextContent).toContain("psyche_context");
    expect(composeContextContent).toContain("fn_get_psyche_traits");
  });

  it("psyche_context output uses psyche_traits key", () => {
    expect(composeContextContent).toContain("'psyche_traits'");
  });

  it("compose_context still has governance_context (TAO) layer", () => {
    expect(composeContextContent).toContain("governance_context");
    expect(composeContextContent).toContain("fn_get_tao_principles");
  });

  it("compose_context header mentions Psyché module", () => {
    expect(composeContextContent).toContain("Psyché");
  });
});

// =============================================================================
// Migration — compose_context update includes psyche_context
// =============================================================================

describe("psyché migration — compose_context update", () => {
  it("migration updates compose_context function", () => {
    expect(psycheMigrationContent).toContain("compose_context");
    expect(psycheMigrationContent).toContain("v_psyche_ctx");
  });

  it("migration updates context_profiles priority_order", () => {
    expect(psycheMigrationContent).toContain("UPDATE context_profiles");
    expect(psycheMigrationContent).toContain("psyche_context");
  });
});

// =============================================================================
// Context profiles — psyche_context in priority_order
// =============================================================================

describe("context_profiles — psyche_context presence", () => {
  const PROFILES_WITH_PSYCHE = [
    "repo_plus_rules",
    "planning_heavy",
    "evidence_strict",
    "chat_lightweight",
    "incident_response",
    "chat_default",
    "dirigent_full",
  ];

  it.each(PROFILES_WITH_PSYCHE)(
    "backbone seed profile %s includes psyche_context",
    (profileSlug) => {
      // Find the profile block in backbone seed
      const profileIdx = backboneSeedContent.indexOf(`'${profileSlug}'`);
      expect(
        profileIdx,
        `Profile ${profileSlug} not found in backbone seed`,
      ).toBeGreaterThan(-1);

      // The priority_order ARRAY should be within 2000 chars after the slug
      const profileBlock = backboneSeedContent.slice(
        profileIdx,
        profileIdx + 2000,
      );
      expect(
        profileBlock,
        `Profile ${profileSlug} missing psyche_context in priority_order`,
      ).toContain("psyche_context");
    },
  );

  it("rules_only profile does NOT include psyche_context", () => {
    const rulesOnlyIdx = backboneSeedContent.indexOf("'rules_only'");
    expect(rulesOnlyIdx).toBeGreaterThan(-1);
    const profileBlock = backboneSeedContent.slice(
      rulesOnlyIdx,
      rulesOnlyIdx + 1000,
    );
    expect(profileBlock).not.toContain("psyche_context");
  });
});

// =============================================================================
// Psyché / TAO separation — no overlap
// =============================================================================

describe("psyché / tao separation", () => {
  it("personality seed does NOT contain core_value item_type", () => {
    const coreValueInPersonality = personalitySeedContent.match(
      /'core_value'/g,
    );
    expect(coreValueInPersonality).toBeNull();
  });

  it("tao seed does NOT contain personality_trait item_type", () => {
    const personalityInTao = taoSeedContent.match(/'personality_trait'/g);
    expect(personalityInTao).toBeNull();
  });

  it("personality UUIDs (a1xxxxxx) do not conflict with tao UUIDs (a2xxxxxx)", () => {
    const personalityUuids = personalitySeedContent.match(
      /a1000001-0000-4000-8000-\d{12}/g,
    );
    const taoUuids = taoSeedContent.match(
      /a2000001-0000-4000-8000-\d{12}/g,
    );

    if (personalityUuids && taoUuids) {
      const overlap = personalityUuids.filter((u) => taoUuids.includes(u));
      expect(overlap).toHaveLength(0);
    }
  });
});

// =============================================================================
// Personality seed — Psyché naming
// =============================================================================

describe("personality seed — psyché module naming", () => {
  it("seed file header references Psyché as brain module", () => {
    expect(personalitySeedContent).toContain("Psyché");
  });

  it("seed file documents brain module map", () => {
    expect(personalitySeedContent).toContain("Brain Module Map");
  });

  it("seed file documents psyche_context layer", () => {
    expect(personalitySeedContent).toContain("psyche_context");
  });

  it("seed file documents fn_get_psyche_traits RPC", () => {
    expect(personalitySeedContent).toContain("fn_get_psyche_traits");
  });

  it("seed file documents trg_protect_psyche_traits trigger", () => {
    expect(personalitySeedContent).toContain("trg_protect_psyche_traits");
  });
});
