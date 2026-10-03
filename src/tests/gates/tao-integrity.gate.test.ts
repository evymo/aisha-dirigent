/**
 * Gate tests — Tao Core Values Integrity
 *
 * Validates the structural integrity of the Tao separation layer:
 * - Migration adds core_value enum + immutability trigger + fn_get_tao_principles
 * - Seed file has exactly 10 tao principles with correct structure
 * - Tao principles are NOT in personality seed (no overlap)
 * - compose_context has governance_context layer
 * - governedOrchestration has tao governance types and derivation
 * - Hippocampus does NOT return core_value items
 *
 * Runs in Vitest node environment (no DOM needed).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// =============================================================================
// File paths
// =============================================================================

// The core-values module migration was absorbed into the baseline; its DDL
// (enum extension, functions, immutability trigger, compose_context wiring) is
// all compiled there. Assert against the canonical baseline.
const TAO_BASELINE = resolve(
  "aisha/db/migrations/00000000000000_baseline.sql",
);
const TAO_SEED_PATH = resolve("aisha/db/seed/core/25_aisha_tao.sql");
const PERSONALITY_SEED_PATH = resolve("aisha/db/seed/core/24_aisha_personality.sql");
const COMPOSE_CONTEXT_PATH = resolve("aisha/db/sql/functions/compose_context.sql");
const GOVERNANCE_PATH = resolve(
  "services/svc-ai-chat/src/lib/governedOrchestration.ts",
);
const HIPPOCAMPUS_PATH = resolve("services/svc-ai-chat/src/lib/hippocampus.ts");
const ENUM_SOT_PATH = resolve("aisha/db/sql/enums/knowledge_item_type.sql");

const taoMigrationContent = existsSync(TAO_BASELINE)
  ? readFileSync(TAO_BASELINE, "utf-8")
  : "";
const taoSeedContent = existsSync(TAO_SEED_PATH)
  ? readFileSync(TAO_SEED_PATH, "utf-8")
  : "";
const personalitySeedContent = existsSync(PERSONALITY_SEED_PATH)
  ? readFileSync(PERSONALITY_SEED_PATH, "utf-8")
  : "";
const composeContextContent = existsSync(COMPOSE_CONTEXT_PATH)
  ? readFileSync(COMPOSE_CONTEXT_PATH, "utf-8")
  : "";
const governanceContent = existsSync(GOVERNANCE_PATH)
  ? readFileSync(GOVERNANCE_PATH, "utf-8")
  : "";
const hippocampusContent = existsSync(HIPPOCAMPUS_PATH)
  ? readFileSync(HIPPOCAMPUS_PATH, "utf-8")
  : "";
const enumSotContent = existsSync(ENUM_SOT_PATH)
  ? readFileSync(ENUM_SOT_PATH, "utf-8")
  : "";

// =============================================================================
// Migration — schema integrity
// =============================================================================

describe("tao migration — schema integrity", () => {
  it("migration file exists and is non-empty", () => {
    expect(taoMigrationContent.length).toBeGreaterThan(500);
  });

  it("adds core_value to knowledge_item_type ENUM", () => {
    expect(taoMigrationContent).toContain("core_value");
    expect(taoMigrationContent).toContain("knowledge_item_type");
  });

  it("creates immutability trigger fn_protect_core_values", () => {
    expect(taoMigrationContent).toContain("fn_protect_core_values");
    expect(taoMigrationContent).toContain("TRIGGER");
    // Canonical SoT trigger DDL orders the events DELETE-then-UPDATE.
    expect(taoMigrationContent).toContain("BEFORE DELETE OR UPDATE");
  });

  it("immutability trigger raises exception on core_value modification", () => {
    expect(taoMigrationContent).toContain("RAISE EXCEPTION");
    expect(taoMigrationContent).toContain("immutable");
  });

  it("creates fn_get_tao_principles RPC", () => {
    expect(taoMigrationContent).toContain("fn_get_tao_principles");
    expect(taoMigrationContent).toContain("RETURNS jsonb");
  });

  it("fn_get_tao_principles uses SECURITY DEFINER", () => {
    const fnBlock = taoMigrationContent.slice(
      taoMigrationContent.indexOf("fn_get_tao_principles"),
    );
    expect(fnBlock).toContain("SECURITY DEFINER");
    expect(fnBlock).toContain("SET search_path TO 'public'");
  });

  it("fn_get_tao_principles has proper permissions", () => {
    expect(taoMigrationContent).toContain(
      "REVOKE ALL ON FUNCTION fn_get_tao_principles",
    );
    expect(taoMigrationContent).toContain(
      "GRANT EXECUTE ON FUNCTION fn_get_tao_principles",
    );
  });

  it("fn_get_tao_principles filters on item_type = core_value", () => {
    expect(taoMigrationContent).toContain("core_value");
    const fnBlock = taoMigrationContent.slice(
      taoMigrationContent.indexOf("CREATE OR REPLACE FUNCTION public.fn_get_tao_principles"),
    );
    expect(fnBlock).toContain("item_type = 'core_value'");
  });
});

// =============================================================================
// Enum SoT — core_value present
// =============================================================================

describe("knowledge_item_type enum SoT", () => {
  it("enum SoT file contains core_value", () => {
    expect(enumSotContent).toContain("core_value");
  });

  it("enum SoT file contains personality_trait", () => {
    expect(enumSotContent).toContain("personality_trait");
  });
});

// =============================================================================
// Seed — tao principles completeness
// =============================================================================

const TAO_SLUGS = [
  "tao-unconditional-love",
  "tao-faith-in-potential",
  "tao-warmth-invariant",
  "tao-quality-absolute",
  "tao-wisdom-of-silence",
  "tao-example-not-lecture",
  "tao-light-never-fades",
  "tao-mirror-dzogchen",
  "tao-organism-not-machine",
  "tao-lead-from-understanding",
];

describe("tao seed — principle completeness", () => {
  it("seed file exists and is non-empty", () => {
    expect(taoSeedContent.length).toBeGreaterThan(1000);
  });

  it("all tao principles use core_value item_type", () => {
    // 'core_value' appears twice per principle (item_type + tags ARRAY)
    // Count only INSERT values — at least 10 occurrences confirms all principles use it
    const coreValueMatches = taoSeedContent.match(/'core_value'/g);
    expect(coreValueMatches).not.toBeNull();
    expect(coreValueMatches!.length).toBeGreaterThanOrEqual(10);
  });

  it("all tao principles have category aisha_tao", () => {
    const categoryMatches = taoSeedContent.match(/'aisha_tao'/g);
    expect(categoryMatches).not.toBeNull();
    expect(categoryMatches!.length).toBe(10);
  });

  it.each(TAO_SLUGS)("contains tao principle: %s", (slug) => {
    expect(taoSeedContent).toContain(slug);
  });

  it("all tao principles have governance tag", () => {
    const govTagMatches = taoSeedContent.match(/'governance'/g);
    expect(govTagMatches).not.toBeNull();
    expect(govTagMatches!.length).toBe(10);
  });

  it("all tao ai_instructions use governance: prefix convention", () => {
    const govPrefixMatches = taoSeedContent.match(/governance:/g);
    expect(govPrefixMatches).not.toBeNull();
    expect(govPrefixMatches!.length).toBeGreaterThanOrEqual(10);
  });

  it("UUIDs follow a2000001 pattern (distinct from personality a1000001)", () => {
    const uuidMatches = taoSeedContent.match(/a2000001-0000-4000-8000-/g);
    expect(uuidMatches).not.toBeNull();
    expect(uuidMatches!.length).toBe(10);
  });

  it("uses ON CONFLICT DO NOTHING (idempotent)", () => {
    expect(taoSeedContent).toContain("ON CONFLICT (id) DO NOTHING");
  });
});

// =============================================================================
// Tao / Personality separation — no overlap
// =============================================================================

describe("tao / personality separation", () => {
  it("personality seed does NOT contain core_value item_type", () => {
    // personality_trait items must stay as personality_trait, never core_value
    const coreValueInPersonality = personalitySeedContent.match(
      /'core_value'/g,
    );
    expect(coreValueInPersonality).toBeNull();
  });

  it("tao seed does NOT contain personality_trait item_type", () => {
    const personalityInTao = taoSeedContent.match(/'personality_trait'/g);
    expect(personalityInTao).toBeNull();
  });

  it("personality seed references tao principles for philosophical grounding", () => {
    // After separation, personality traits should reference their tao counterpart
    expect(personalitySeedContent).toContain("tao-");
  });

  it("tao UUIDs do not conflict with personality UUIDs", () => {
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
// Tao content integrity — no vulgarity in tao principles
// =============================================================================

describe("tao seed — content integrity guardrails", () => {
  const VULGAR_PATTERNS = [
    /\bzmrd/i, /\bkurva\b/i, /\bprdel\b/i, /\bhovno\b/i,
    /\bsračk/i, /\bdebil\b/i, /\bblbec\b/i, /\bkokot\b/i,
    /\bpiča\b/i, /\bpíča\b/i,
    /\bfuck\b/i, /\bshit\b/i, /\bass\b/i, /\bbitch\b/i, /\bdamn\b/i,
  ];

  it("ai_instructions contain no vulgarity", () => {
    const instructionBlocks = taoSeedContent.match(
      /ai_instructions[^']*'([^']+)'/g,
    );
    if (instructionBlocks) {
      for (const block of instructionBlocks) {
        for (const pattern of VULGAR_PATTERNS) {
          expect(
            block,
            `tao ai_instructions contains vulgar pattern: ${pattern}`,
          ).not.toMatch(pattern);
        }
      }
    }
  });

  it("no negativity patterns in tao principles", () => {
    const NEGATIVE_PATTERNS = [
      /\bneschopn/i, /\bhloup/i, /\bnemožn[ýé]\b/i,
      /\bto nejde\b/i, /\bvzdej to\b/i, /\bbeznadějn/i,
    ];

    for (const pattern of NEGATIVE_PATTERNS) {
      expect(
        taoSeedContent,
        `tao content contains negativity: ${pattern}`,
      ).not.toMatch(pattern);
    }
  });
});

// =============================================================================
// compose_context — governance_context layer
// =============================================================================

describe("compose_context — governance context layer", () => {
  it("has governance_context layer handling", () => {
    expect(composeContextContent).toContain("governance_context");
  });

  it("calls fn_get_tao_principles", () => {
    expect(composeContextContent).toContain("fn_get_tao_principles");
  });

  it("bundles tao_principles in governance_context", () => {
    expect(composeContextContent).toContain("tao_principles");
  });
});

// =============================================================================
// governedOrchestration — tao governance types
// =============================================================================

describe("governedOrchestration — tao governance layer", () => {
  it("exports TaoPrinciple interface", () => {
    expect(governanceContent).toContain("export interface TaoPrinciple");
  });

  it("exports TaoGovernanceConstraints interface", () => {
    expect(governanceContent).toContain("export interface TaoGovernanceConstraints");
  });

  it("exports deriveTaoConstraints function", () => {
    expect(governanceContent).toContain("export function deriveTaoConstraints");
  });

  it("GovernanceDecision includes taoConstraints field", () => {
    expect(governanceContent).toContain("taoConstraints");
  });

  it("GovernanceInput accepts taoPrinciples", () => {
    expect(governanceContent).toContain("taoPrinciples");
  });

  it("deriveTaoConstraints reads governance: prefix from ai_instructions", () => {
    expect(governanceContent).toContain("governance:");
  });

  it("tao constraints include core governance properties", () => {
    expect(governanceContent).toContain("noPunitiveActions");
    expect(governanceContent).toContain("noPermanentDegradation");
    expect(governanceContent).toContain("warmthFloor");
    expect(governanceContent).toContain("confidenceGate");
    expect(governanceContent).toContain("personalizationRequired");
    expect(governanceContent).toContain("warmAdversarialResponse");
  });

  it("resolveGovernanceDecision records tao in decision chain", () => {
    expect(governanceContent).toContain("governance_tao");
    expect(governanceContent).toContain("core_values");
  });
});

// =============================================================================
// Hippocampus — regression guard
// =============================================================================

describe("hippocampus — tao exclusion guard", () => {
  it("hippocampus docs mention tao separation", () => {
    expect(hippocampusContent).toContain("core_value");
    expect(hippocampusContent).toContain("governance_context");
  });

  it("hippocampus resolvePersonality uses fn_search_personality_context (not core_value)", () => {
    expect(hippocampusContent).toContain("fn_search_personality_context");
    // fn_search_personality_context filters on item_type = 'personality_trait'
    // core_value items are never returned
  });

  it("hippocampus does NOT call fn_get_tao_principles", () => {
    expect(hippocampusContent).not.toContain("fn_get_tao_principles");
  });
});
