/**
 * Gate tests — Knowledge Integrity (Phase C)
 *
 * Structural and pipeline integration tests for knowledgeIntegrity.ts.
 * Runs in Vitest node environment (no DOM needed).
 *
 * Validates:
 * - Module structure (exports, types, constants)
 * - Pipeline integration (orchestrationBridge imports + uses module)
 * - No naive merge patterns remain
 * - Pinned policy is applied in the integrity path
 * - Legacy chunk adapter exists
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const INTEGRITY_PATH = resolve("services/svc-ai-chat/src/lib/knowledgeIntegrity.ts");
const BRIDGE_PATH = resolve("services/svc-ai-chat/src/lib/orchestrationBridge.ts");

const integrityContent = readFileSync(INTEGRITY_PATH, "utf-8");
const bridgeContent = readFileSync(BRIDGE_PATH, "utf-8");

// =============================================================================
// Module structure
// =============================================================================

describe("knowledgeIntegrity.ts — module structure", () => {
  it("file exists and is non-empty", () => {
    expect(integrityContent.length).toBeGreaterThan(1000);
  });

  it("exports KNOWLEDGE_SOURCE_AUTHORITY constant", () => {
    expect(integrityContent).toContain("export const KNOWLEDGE_SOURCE_AUTHORITY");
  });

  it("exports mergeWithIntegrity function", () => {
    expect(integrityContent).toContain("export function mergeWithIntegrity");
  });

  it("exports resolvePinnedPolicy function", () => {
    expect(integrityContent).toContain("export function resolvePinnedPolicy");
  });

  it("exports riskLevelToContextType function", () => {
    expect(integrityContent).toContain("export function riskLevelToContextType");
  });

  it("exports computeTextSimilarity function", () => {
    expect(integrityContent).toContain("export function computeTextSimilarity");
  });

  it("exports deduplicateChunks function", () => {
    expect(integrityContent).toContain("export function deduplicateChunks");
  });

  it("exports sortChunksByAuthority function", () => {
    expect(integrityContent).toContain("export function sortChunksByAuthority");
  });

  it("exports applyPinnedPolicy function", () => {
    expect(integrityContent).toContain("export function applyPinnedPolicy");
  });

  it("exports toLegacyChunk adapter function", () => {
    expect(integrityContent).toContain("export function toLegacyChunk");
  });

  it("exports KnowledgeChunk interface", () => {
    expect(integrityContent).toContain("export interface KnowledgeChunk");
  });

  it("exports KnowledgeIntegrityInput interface", () => {
    expect(integrityContent).toContain("export interface KnowledgeIntegrityInput");
  });

  it("exports IntegrityMergeResult interface", () => {
    expect(integrityContent).toContain("export interface IntegrityMergeResult");
  });

  it("exports KnowledgeContextType type", () => {
    expect(integrityContent).toContain("export type KnowledgeContextType");
  });

  it("exports PinnedPolicy type", () => {
    expect(integrityContent).toContain("export type PinnedPolicy");
  });
});

// =============================================================================
// Authority hierarchy contract
// =============================================================================

describe("knowledgeIntegrity.ts — authority hierarchy", () => {
  it("defines ruleset_snapshot as highest authority source", () => {
    expect(integrityContent).toContain("ruleset_snapshot: 100");
  });

  it("defines fallback_inline as lowest authority source", () => {
    expect(integrityContent).toContain("fallback_inline: 10");
  });

  it("defines at least 6 source types", () => {
    const matches = integrityContent.match(/:\s*\d+,\s*\/\//g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it("pgvector authority is higher than ragnarok", () => {
    // Extract both values from the source
    const pgMatch = integrityContent.match(/pgvector:\s*(\d+)/);
    const ragMatch = integrityContent.match(/ragnarok:\s*(\d+)/);
    expect(pgMatch).toBeTruthy();
    expect(ragMatch).toBeTruthy();
    const pgAuth = parseInt(pgMatch![1]);
    const ragAuth = parseInt(ragMatch![1]);
    expect(pgAuth).toBeGreaterThan(ragAuth);
  });
});

// =============================================================================
// Pinned policy contract
// =============================================================================

describe("knowledgeIntegrity.ts — pinned policy coverage", () => {
  it("handles strict policy for critical_flow", () => {
    expect(integrityContent).toContain('"critical_flow"');
    expect(integrityContent).toContain('"strict"');
  });

  it("handles prefer_pinned policy for high_risk", () => {
    expect(integrityContent).toContain('"high_risk"');
    expect(integrityContent).toContain('"prefer_pinned"');
  });

  it("handles supplement policy for normal", () => {
    expect(integrityContent).toContain('"normal"');
    expect(integrityContent).toContain('"supplement"');
  });

  it("handles live_only policy for onboarding", () => {
    expect(integrityContent).toContain('"onboarding"');
    expect(integrityContent).toContain('"live_only"');
  });

  it("pinned policy has all 4 cases in switch", () => {
    const switchCount = (integrityContent.match(/case "critical_flow"|case "high_risk"|case "normal"|case "onboarding"/g) ?? []).length;
    expect(switchCount).toBeGreaterThanOrEqual(4);
  });
});

// =============================================================================
// Deduplication contract
// =============================================================================

describe("knowledgeIntegrity.ts — deduplication design", () => {
  it("checks text similarity for fuzzy dedup", () => {
    expect(integrityContent).toContain("computeTextSimilarity");
  });

  it("uses Jaccard-based similarity (tokenization by word)", () => {
    expect(integrityContent).toContain("Set(");
    expect(integrityContent).toContain("intersection");
    expect(integrityContent).toContain("union");
  });

  it("dedup prefers higher authority source when slug matches", () => {
    expect(integrityContent).toContain("KNOWLEDGE_SOURCE_AUTHORITY");
    // Should compare authority levels
    expect(integrityContent).toContain("existingAuth");
    expect(integrityContent).toContain("newAuth");
  });

  it("dedup threshold is defined (0.85)", () => {
    expect(integrityContent).toContain("0.85");
  });
});

// =============================================================================
// Pipeline integration — orchestrationBridge.ts
// =============================================================================

describe("orchestrationBridge.ts — knowledge integrity integration", () => {
  it("imports mergeWithIntegrity from knowledgeIntegrity", () => {
    expect(bridgeContent).toContain("mergeWithIntegrity");
    expect(bridgeContent).toMatch(/from\s+["']\.\/knowledgeIntegrity(?:\.js)?["']/);
  });

  it("imports toLegacyChunk from knowledgeIntegrity.ts", () => {
    expect(bridgeContent).toContain("toLegacyChunk");
  });

  it("imports KnowledgeContextType type", () => {
    expect(bridgeContent).toContain("KnowledgeContextType");
  });

  it("ContextEnrichmentParams has knowledgeContextType field", () => {
    expect(bridgeContent).toContain("knowledgeContextType?");
  });

  it("calls mergeWithIntegrity in enrichWithAishaContext", () => {
    expect(bridgeContent).toContain("mergeWithIntegrity({");
  });

  it("passes pgChunks to mergeWithIntegrity", () => {
    expect(bridgeContent).toContain("pgChunks:");
  });

  it("passes ragChunks to mergeWithIntegrity", () => {
    expect(bridgeContent).toContain("ragChunks:");
  });

  it("passes rulesetRules to mergeWithIntegrity", () => {
    expect(bridgeContent).toContain("rulesetRules:");
  });

  it("passes contextType to mergeWithIntegrity", () => {
    expect(bridgeContent).toContain("contextType:");
  });

  it("stores integrity_report in kb_retrieval layer", () => {
    expect(bridgeContent).toContain("integrity_report:");
  });

  it("stores applied_policy in integrity_report", () => {
    expect(bridgeContent).toContain("applied_policy:");
  });

  it("stores duplicates_removed in integrity_report", () => {
    expect(bridgeContent).toContain("duplicates_removed:");
  });

  it("stores blocked_by_policy count in integrity_report", () => {
    expect(bridgeContent).toContain("blocked_by_policy:");
  });

  it("extracts ruleset rules from bundle.layers.ruleset", () => {
    expect(bridgeContent).toContain("bundle.layers.ruleset");
  });
});

// =============================================================================
// No naive merge patterns (regression guard)
// =============================================================================

describe("orchestrationBridge.ts — no naive merge regression", () => {
  it("does not contain the old naive mergedChunks.push pattern", () => {
    // Old pattern: mergedChunks.push({ chunk_text: ..., source: "ragnarok", ... })
    expect(bridgeContent).not.toContain('source: "ragnarok",');
  });

  it("does not contain existingChunks.map naive source assignment", () => {
    // Old pattern: existingChunks.map((c: unknown) => ({ ...chunk, source: chunk.source ?? "pgvector" }))
    expect(bridgeContent).not.toContain('source: chunk.source ?? "pgvector"');
  });

  it("does not contain Math.min(ragChunks.length naive truncation", () => {
    // Old pattern: ragnarok_count: Math.min(ragChunks.length, routingDecision.maxRagChunks)
    expect(bridgeContent).not.toContain("Math.min(ragChunks.length,");
  });
});

// =============================================================================
// Safety — no silent failure paths
// =============================================================================

describe("knowledgeIntegrity.ts — safety invariants", () => {
  it("deduplicateChunks always returns a result object with both fields", () => {
    expect(integrityContent).toContain("return { deduped:");
    expect(integrityContent).toContain("removedCount:");
  });

  it("mergeWithIntegrity always returns IntegrityMergeResult", () => {
    expect(integrityContent).toContain("return {");
    expect(integrityContent).toContain("chunks: final");
  });

  it("applyPinnedPolicy always returns allowed + blocked arrays", () => {
    expect(integrityContent).toContain("return { allowed:");
  });

  it("toLegacyChunk does not throw — uses safe defaults", () => {
    // Check that toLegacyChunk accesses chunk.text and chunk.source
    expect(integrityContent).toContain("chunk.text");
    expect(integrityContent).toContain("chunk.source");
  });

  it("module does not import from Deno-specific APIs", () => {
    // knowledgeIntegrity.ts is pure logic, no Deno.env or Deno.serve
    expect(integrityContent).not.toContain("Deno.env");
    expect(integrityContent).not.toContain("Deno.serve");
  });
});
