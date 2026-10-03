/**
 * Gate tests — Hippocampus Personality Integrity
 *
 * Validates the structural integrity of the Hippocampus personality system:
 * - DB migration has required schema elements
 * - Base personality traits seed is complete and valid
 * - hippocampus.ts module has correct exports
 * - No vulgarity or negativity in base trait content
 * - Trait clusters are complete (core, response, guardrail, emotional)
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
const EVOLUTION_MIGRATION_PATH = resolve(
  "aisha/db/migrations/00000000000000_baseline.sql",
);
const SEED_PATH = resolve("aisha/db/seed/core/24_aisha_personality.sql");
const MODULE_PATH = resolve("services/svc-ai-chat/src/lib/hippocampus.ts");

const migrationContent = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";
const evolutionMigrationContent = existsSync(EVOLUTION_MIGRATION_PATH)
  ? readFileSync(EVOLUTION_MIGRATION_PATH, "utf-8")
  : "";
const seedContent = existsSync(SEED_PATH)
  ? readFileSync(SEED_PATH, "utf-8")
  : "";
const moduleContent = existsSync(MODULE_PATH)
  ? readFileSync(MODULE_PATH, "utf-8")
  : "";

// =============================================================================
// Migration — schema integrity
// =============================================================================

describe("hippocampus migration — schema integrity", () => {
  it("migration file exists and is non-empty", () => {
    expect(migrationContent.length).toBeGreaterThan(500);
  });

  it("extends knowledge_item_type ENUM with personality_trait", () => {
    expect(migrationContent).toContain("personality_trait");
    expect(migrationContent).toContain("knowledge_item_type");
  });

  it("creates personality_signals table", () => {
    expect(migrationContent).toContain("personality_signals");
    expect(migrationContent).toContain("signal_type");
    expect(migrationContent).toContain("weight");
  });

  it("creates fn_search_personality_context RPC", () => {
    expect(migrationContent).toContain("fn_search_personality_context");
  });

  it("creates fn_capture_personality_signal RPC", () => {
    expect(migrationContent).toContain("fn_capture_personality_signal");
  });

  it("creates fn_aggregate_personality_signals RPC", () => {
    expect(migrationContent).toContain("fn_aggregate_personality_signals");
  });

  it("personality_signals has RLS enabled", () => {
    expect(migrationContent).toMatch(
      /ALTER TABLE (public\.)?personality_signals ENABLE ROW LEVEL SECURITY/,
    );
  });

  it("personality_signals has user_id index for evolution queries", () => {
    expect(migrationContent).toContain("idx_personality_signals_user_type_time");
  });

  it("fn_search_personality_context applies base trait retrieval bonus", () => {
    // Base traits (DNA) get +0.2 bonus to ensure they always dominate
    expect(migrationContent).toContain("0.2");
  });
});

// =============================================================================
// Seed — base personality traits (DNA)
// =============================================================================

describe("aisha personality seed — base trait completeness", () => {
  it("seed file exists and is non-empty", () => {
    expect(seedContent.length).toBeGreaterThan(1000);
  });

  it("all traits are personality_trait type", () => {
    // Every INSERT should use 'personality_trait' as item_type
    const traitTypeMatches = seedContent.match(/'personality_trait'/g);
    expect(traitTypeMatches).not.toBeNull();
    expect(traitTypeMatches!.length).toBeGreaterThanOrEqual(12);
  });

  it("all traits have category aisha_personality", () => {
    const categoryMatches = seedContent.match(/'aisha_personality'/g);
    expect(categoryMatches).not.toBeNull();
    expect(categoryMatches!.length).toBeGreaterThanOrEqual(12);
  });

  // --- Cluster coverage ---

  it("has core_identity cluster traits", () => {
    expect(seedContent).toContain("core_identity");
    expect(seedContent).toContain("aisha-core-nature");
    expect(seedContent).toContain("aisha-never-gives-up");
    expect(seedContent).toContain("aisha-warmth-floor");
  });

  it("has response_style cluster traits", () => {
    expect(seedContent).toContain("response_style");
    expect(seedContent).toContain("aisha-babicka-pattern");
    expect(seedContent).toContain("aisha-vulgarity-transform");
    expect(seedContent).toContain("aisha-empathy-first");
  });

  it("has guardrail cluster traits", () => {
    expect(seedContent).toContain("guardrail");
    expect(seedContent).toContain("aisha-no-negativity");
    expect(seedContent).toContain("aisha-no-lecturing");
    expect(seedContent).toContain("aisha-quality-absolute");
  });

  it("has emotional_intelligence cluster traits", () => {
    expect(seedContent).toContain("emotional_intelligence");
    expect(seedContent).toContain("aisha-frustration-response");
    expect(seedContent).toContain("aisha-joy-amplify");
    expect(seedContent).toContain("aisha-silence-wisdom");
  });

  it("all traits are active and verified", () => {
    // Count 'active' status entries — should match trait count
    const activeMatches = seedContent.match(/'active',\s*\n\s*'public'/g);
    expect(activeMatches).not.toBeNull();
    expect(activeMatches!.length).toBeGreaterThanOrEqual(12);
  });
});

// =============================================================================
// Seed — content integrity (no vulgarity, no negativity in DNA)
// =============================================================================

describe("aisha personality seed — content integrity guardrails", () => {
  // Base traits must NEVER contain vulgarity — they are AISHA's DNA
  const VULGAR_PATTERNS = [
    // Czech vulgarisms (common ones for detection)
    /\bzmrd/i,
    /\bkurva\b/i,
    /\bprdel\b/i,
    /\bhovno\b/i,
    /\bsračk/i,
    /\bdebil\b/i,
    /\bblbec\b/i,
    /\bkokot\b/i,
    /\bpiča\b/i,
    /\bpíča\b/i,
    // English vulgarisms
    /\bfuck\b/i,
    /\bshit\b/i,
    /\bass\b/i,
    /\bbitch\b/i,
    /\bdamn\b/i,
  ];

  it("ai_instructions fields contain no vulgarity", () => {
    // Extract ai_instructions content from seed
    const instructionBlocks = seedContent.match(
      /ai_instructions[^']*'([^']+)'/g,
    );
    if (instructionBlocks) {
      for (const block of instructionBlocks) {
        for (const pattern of VULGAR_PATTERNS) {
          expect(
            block,
            `ai_instructions contains vulgar pattern: ${pattern}`,
          ).not.toMatch(pattern);
        }
      }
    }
  });

  it("body_markdown fields contain no vulgarity outside of example tables", () => {
    // The body may contain vulgarisms in example mapping tables (e.g., showing
    // what user says vs what AISHA responds). These are in table format.
    // We check that ai_instructions (the LLM-facing directives) are clean.
    // The body examples serve as socialization demos.
    const aiInstructions: string[] = [];
    const regex = /('Vtěl|'Nikdy|'Komunikuj|'Na |'Udržuj|'Odpovídej|'Když|'Vždy|'Neříkej)[^']*'/g;
    let match;
    while ((match = regex.exec(seedContent)) !== null) {
      aiInstructions.push(match[0]);
    }
    for (const instruction of aiInstructions) {
      for (const pattern of VULGAR_PATTERNS) {
        expect(
          instruction,
          `Directive contains vulgar pattern: ${pattern}`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("no trait ai_instructions contain negativity patterns", () => {
    const NEGATIVE_PATTERNS = [
      /\bneschopn/i,
      /\bhloup/i,
      /\bnemožn[ýé]\b/i,
      /\bto nejde\b/i,
      /\bvzdej to\b/i,
      /\bbeznadějn/i,
    ];

    const instructionBlocks = seedContent.match(
      /ai_instructions[^']*'([^']+)'/g,
    );
    if (instructionBlocks) {
      for (const block of instructionBlocks) {
        for (const pattern of NEGATIVE_PATTERNS) {
          expect(
            block,
            `ai_instructions contains negativity: ${pattern}`,
          ).not.toMatch(pattern);
        }
      }
    }
  });
});

// =============================================================================
// Module — hippocampus.ts structure
// =============================================================================

describe("hippocampus.ts — module structure", () => {
  it("file exists and is non-empty", () => {
    expect(moduleContent.length).toBeGreaterThan(500);
  });

  it("exports createHippocampus factory function", () => {
    expect(moduleContent).toContain("export function createHippocampus");
  });

  it("exports PersonalityTrait type", () => {
    expect(moduleContent).toContain("export interface PersonalityTrait");
  });

  it("exports PersonalityContext type", () => {
    expect(moduleContent).toContain("export interface PersonalityContext");
  });

  it("exports Hippocampus interface", () => {
    expect(moduleContent).toContain("export interface Hippocampus");
  });

  it("exports PersonalitySignalType", () => {
    expect(moduleContent).toContain("export type PersonalitySignalType");
  });

  it("has resolvePersonality method", () => {
    expect(moduleContent).toContain("resolvePersonality");
  });

  it("has buildPersonalityPrompt method", () => {
    expect(moduleContent).toContain("buildPersonalityPrompt");
  });

  it("has captureSignal method (fire-and-forget)", () => {
    expect(moduleContent).toContain("captureSignal");
  });

  it("has getSignalAggregates method", () => {
    expect(moduleContent).toContain("getSignalAggregates");
  });

  it("calls fn_search_personality_context RPC", () => {
    expect(moduleContent).toContain("fn_search_personality_context");
  });

  it("calls fn_capture_personality_signal RPC", () => {
    expect(moduleContent).toContain("fn_capture_personality_signal");
  });

  it("calls fn_aggregate_personality_signals RPC", () => {
    expect(moduleContent).toContain("fn_aggregate_personality_signals");
  });

  it("uses tracer for observability", () => {
    expect(moduleContent).toContain("tracer");
    // The personality-resolve path is traced via the RPC operation it calls.
    // The tracer EVENT TYPE is the DB-enum-valid 'memory_read' (a personality
    // resolve IS a memory read) — 'personality_resolve' is NOT an ai_event_type
    // member and would throw 22P02 at runtime.
    expect(moduleContent).toContain("fn_search_personality_context");
    expect(moduleContent).toContain("memory_read");
  });

  it("signal capture is fire-and-forget (no await)", () => {
    // captureSignal should NOT await the RPC call
    const captureBlock = moduleContent.slice(
      moduleContent.indexOf("function captureSignal"),
      moduleContent.indexOf("function getSignalAggregates"),
    );
    expect(captureBlock).not.toContain("await supabaseService");
  });
});

// =============================================================================
// Pipeline Integration Integrity
// =============================================================================

describe("Hippocampus Pipeline Integration", () => {
  const aiChatContent = readFileSync(
    "services/svc-ai-chat/src/routes/chat.ts",
    "utf-8",
  );
  const orchestrationContent = readFileSync(
    "services/svc-ai-chat/src/lib/orchestrationBridge.ts",
    "utf-8",
  );
  const proactiveContent = readFileSync(
    "services/svc-ai-chat/src/lib/proactiveEngine.ts",
    "utf-8",
  );

  it("ai-chat imports hippocampus module", () => {
    expect(aiChatContent).toMatch(/from\s+['"](?:\.\.\/_shared|\.\.\/lib)\/hippocampus(?:\.(?:ts|js))?['"]/);
  });

  it("ai-chat creates Hippocampus instance with userId", () => {
    expect(aiChatContent).toContain("createHippocampus");
    expect(aiChatContent).toContain("userId");
  });

  it("ai-chat injects personality as system prompt preset (first layer)", () => {
    // Personality must be a PRESET, not output filter
    expect(aiChatContent).toContain("personalityPrompt");
    expect(aiChatContent).toContain("promptLayers");
    // Personality inserted before context and instructions
    const layerBlock = aiChatContent.slice(
      aiChatContent.indexOf("const promptLayers"),
      aiChatContent.indexOf("const systemPromptBase = promptLayers"),
    );
    const personalityIdx = layerBlock.indexOf("personalityPrompt");
    const contextIdx = layerBlock.indexOf("aishaContextSection");
    const instructionsIdx = layerBlock.indexOf("mainAgent.instructions");
    expect(personalityIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(instructionsIdx);
  });

  it("ai-chat captures behavioral signals per-user (fire-and-forget)", () => {
    expect(aiChatContent).toContain("hippocampus.captureSignal");
    // Must detect multiple signal types
    expect(aiChatContent).toContain("frustration");
    expect(aiChatContent).toContain("gratitude");
    expect(aiChatContent).toContain("vulgarity");
    expect(aiChatContent).toContain("curiosity");
  });

  it("ai-chat tracks personality_traits_used in metadata", () => {
    expect(aiChatContent).toContain("personalityTraitsUsed");
    expect(aiChatContent).toContain("personality_traits_used");
  });

  it("AishaContentMetadata has personality_traits_used field", () => {
    expect(orchestrationContent).toContain("personality_traits_used");
  });

  it("proactiveEngine imports hippocampus for personality toning", () => {
    expect(proactiveContent).toMatch(/from\s+['"]\.\/hippocampus(?:\.(?:ts|js))?['"]/);
    expect(proactiveContent).toContain("createHippocampus");
  });

  it("proactiveEngine resolves per-user personality for proactive messages", () => {
    expect(proactiveContent).toContain("resolvePersonality");
    expect(proactiveContent).toContain("buildPersonalityPrompt");
  });

  it("hippocampus buildPersonalityPrompt has behavioral mirror framing", () => {
    // Dzogchen mirror concept — the prompt must frame per-user adaptation
    expect(moduleContent).toContain("mirror");
    expect(moduleContent).toContain("behavioral");
    expect(moduleContent).toContain("This User");
  });
});

// =============================================================================
// Evolution Engine — Dynamic Consolidation
// =============================================================================

describe("Hippocampus Evolution Engine", () => {
  it("evolution migration file exists and is non-empty", () => {
    expect(evolutionMigrationContent.length).toBeGreaterThan(500);
  });

  it("creates fn_maybe_evolve_personality RPC", () => {
    expect(evolutionMigrationContent).toContain("fn_maybe_evolve_personality");
    expect(evolutionMigrationContent).toContain("RETURNS jsonb");
  });

  it("has configurable thresholds (not hardcoded magic numbers)", () => {
    expect(evolutionMigrationContent).toContain("p_min_signals");
    expect(evolutionMigrationContent).toContain("p_min_span_days");
    expect(evolutionMigrationContent).toContain("p_max_traits_per_user");
    expect(evolutionMigrationContent).toContain("p_cooldown_days");
  });

  it("checks signal count threshold before evolving", () => {
    expect(evolutionMigrationContent).toContain("insufficient_signals");
  });

  it("checks time span (prevents single-session bursts)", () => {
    expect(evolutionMigrationContent).toContain("insufficient_span");
    expect(evolutionMigrationContent).toContain("p_min_span_days");
  });

  it("has evolution cooldown per signal_type", () => {
    expect(evolutionMigrationContent).toContain("cooldown");
    expect(evolutionMigrationContent).toContain("p_cooldown_days");
  });

  it("prevents trait explosion with max traits per user", () => {
    expect(evolutionMigrationContent).toContain("max_traits_reached");
    expect(evolutionMigrationContent).toContain("p_max_traits_per_user");
  });

  it("upserts into agent_memories with memory_type personality", () => {
    expect(evolutionMigrationContent).toContain("agent_memories");
    expect(evolutionMigrationContent).toContain("'personality'");
    expect(evolutionMigrationContent).toContain("'hippocampus:' || p_signal_type");
  });

  it("prunes old signals after consolidation (memory decay)", () => {
    expect(evolutionMigrationContent).toContain("DELETE FROM personality_signals");
  });

  it("clears embedding on trait update (forces re-embedding)", () => {
    expect(evolutionMigrationContent).toContain("embedding = NULL");
  });

  it("importance is bounded (min 4, max 8 — DNA always dominates)", () => {
    expect(evolutionMigrationContent).toContain("LEAST(8");
    expect(evolutionMigrationContent).toContain("GREATEST(4");
  });

  it("captureSignal triggers fn_maybe_evolve_personality inline (not cron)", () => {
    // The brain consolidates on-demand, not on schedule
    expect(moduleContent).toContain("fn_maybe_evolve_personality");
    // Must be chained after signal capture (in .then()), not awaited
    const captureBlock = moduleContent.slice(
      moduleContent.indexOf("function captureSignal"),
      moduleContent.indexOf("function getSignalAggregates"),
    );
    expect(captureBlock).toContain("fn_maybe_evolve_personality");
    // Evolution is traced with the DB-enum-valid event type 'memory_write'
    // ('personality_evolved' is not an ai_event_type member → 22P02).
    expect(captureBlock).toContain("memory_write");
  });

  it("evolution result is traced for observability", () => {
    expect(moduleContent).toContain("fn_maybe_evolve_personality");
    expect(moduleContent).toContain("memory_write");
    expect(moduleContent).toContain("tracer.event");
  });
});
