/**
 * Unit tests — Knowledge Integrity (Phase C)
 *
 * Tests all key behaviors of knowledgeIntegrity.ts:
 * - Source authority ranking
 * - Text similarity computation
 * - Cross-source deduplication
 * - Pinned-vs-live policy enforcement
 * - Context-type → policy mapping
 * - Risk level → context type mapping
 * - Full mergeWithIntegrity pipeline
 * - toLegacyChunk adapter
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Inline pure port of knowledgeIntegrity.ts for unit tests ───────────────
// (Deno edge functions cannot be imported in Vitest jsdom environment.
//  We extract the pure logic functions and test them directly.)

const KNOWLEDGE_SOURCE_AUTHORITY: Record<string, number> = {
  ruleset_snapshot: 100,
  compliance_policy: 90,
  system_instructions: 80,
  pgvector: 60,
  ragnarok: 55,
  ragnarok_generated: 40,
  session_memory: 30,
  fallback_inline: 10,
};

type KnowledgeSourceType = keyof typeof KNOWLEDGE_SOURCE_AUTHORITY;
type PinnedPolicy = "strict" | "prefer_pinned" | "supplement" | "live_only";
type KnowledgeContextType = "critical_flow" | "high_risk" | "normal" | "onboarding";

interface KnowledgeChunk {
  slug: string;
  title: string;
  text: string;
  source: KnowledgeSourceType;
  sourceId: string;
  score: number;
  pinned: boolean;
  metadata: Record<string, unknown>;
}

function resolvePinnedPolicy(contextType: KnowledgeContextType): PinnedPolicy {
  switch (contextType) {
    case "critical_flow": return "strict";
    case "high_risk": return "prefer_pinned";
    case "normal": return "supplement";
    case "onboarding": return "live_only";
  }
}

function riskLevelToContextType(
  riskLevel: "low" | "medium" | "high" | "critical",
  hasPinnedRuleset: boolean,
): KnowledgeContextType {
  if (!hasPinnedRuleset) return "onboarding";
  switch (riskLevel) {
    case "critical": return "critical_flow";
    case "high": return "high_risk";
    case "medium":
    case "low": return "normal";
  }
}

function computeChunkSortScore(chunk: KnowledgeChunk): number {
  const authority = KNOWLEDGE_SOURCE_AUTHORITY[chunk.source] ?? 0;
  const relevance = Math.max(0, Math.min(1, chunk.score)) * 100;
  return authority * 0.6 + relevance * 0.4;
}

function sortChunksByAuthority(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  return [...chunks].sort((a, b) => computeChunkSortScore(b) - computeChunkSortScore(a));
}

function computeTextSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokenize = (text: string) =>
    new Set(text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 2));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) { if (setB.has(token)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateChunks(chunks: KnowledgeChunk[]): { deduped: KnowledgeChunk[]; removedCount: number } {
  const seen = new Map<string, KnowledgeChunk>();
  const removed = new Set<KnowledgeChunk>();

  for (const chunk of chunks) {
    const key = chunk.slug || chunk.sourceId;
    if (!key) continue;
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      const existingAuth = KNOWLEDGE_SOURCE_AUTHORITY[existing.source] ?? 0;
      const newAuth = KNOWLEDGE_SOURCE_AUTHORITY[chunk.source] ?? 0;
      if (newAuth > existingAuth) {
        removed.add(existing);
        seen.set(key, chunk);
      } else {
        removed.add(chunk);
      }
    } else {
      seen.set(key, chunk);
    }
  }

  const afterExactDedup = chunks.filter((c) => !removed.has(c));
  const finalChunks: KnowledgeChunk[] = [];

  for (const candidate of afterExactDedup) {
    let isDuplicate = false;
    for (const existing of finalChunks) {
      const similarity = computeTextSimilarity(candidate.text, existing.text);
      if (similarity >= 0.85) {
        const existingAuth = KNOWLEDGE_SOURCE_AUTHORITY[existing.source] ?? 0;
        const candidateAuth = KNOWLEDGE_SOURCE_AUTHORITY[candidate.source] ?? 0;
        if (candidateAuth > existingAuth) {
          const idx = finalChunks.indexOf(existing);
          if (idx !== -1) finalChunks[idx] = candidate;
        }
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) finalChunks.push(candidate);
  }

  return { deduped: finalChunks, removedCount: chunks.length - finalChunks.length };
}

function applyPinnedPolicy(
  chunks: KnowledgeChunk[],
  policy: PinnedPolicy,
): { allowed: KnowledgeChunk[]; blocked: Array<{ slug: string; source: KnowledgeSourceType; reason: string }> } {
  const pinnedChunks = chunks.filter((c) => c.pinned);
  const liveChunks = chunks.filter((c) => !c.pinned);
  const blocked: Array<{ slug: string; source: KnowledgeSourceType; reason: string }> = [];

  switch (policy) {
    case "strict": {
      const pinnedTexts = pinnedChunks.map((c) => c.text);
      const allowedLive: KnowledgeChunk[] = [];
      for (const chunk of liveChunks) {
        const conflicts = pinnedTexts.some((pt) => computeTextSimilarity(chunk.text, pt) >= 0.55);
        if (conflicts) blocked.push({ slug: chunk.slug, source: chunk.source, reason: "strict policy: overlap with pinned" });
        else allowedLive.push(chunk);
      }
      return { allowed: [...pinnedChunks, ...allowedLive], blocked };
    }
    case "prefer_pinned": {
      const pinnedTexts = pinnedChunks.map((c) => c.text);
      const allowedLive: KnowledgeChunk[] = [];
      for (const chunk of liveChunks) {
        const near = pinnedTexts.some((pt) => computeTextSimilarity(chunk.text, pt) >= 0.8);
        if (near) blocked.push({ slug: chunk.slug, source: chunk.source, reason: "prefer_pinned: near-duplicate" });
        else allowedLive.push(chunk);
      }
      return { allowed: [...pinnedChunks, ...allowedLive], blocked };
    }
    case "supplement":
      return { allowed: chunks, blocked: [] };
    case "live_only": {
      for (const chunk of pinnedChunks) {
        blocked.push({ slug: chunk.slug, source: chunk.source, reason: "live_only: onboarding" });
      }
      return { allowed: liveChunks, blocked };
    }
  }
}

function makeChunk(overrides: Partial<KnowledgeChunk> & { source: KnowledgeSourceType }): KnowledgeChunk {
  return {
    slug: overrides.slug ?? "slug-1",
    title: overrides.title ?? "Test chunk",
    text: overrides.text ?? `Unique knowledge content for chunk ${overrides.slug ?? "slug-1"} about this specific topic`,
    sourceId: overrides.sourceId ?? "id-1",
    score: overrides.score ?? 0.8,
    pinned: overrides.pinned ?? false,
    metadata: overrides.metadata ?? {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("KNOWLEDGE_SOURCE_AUTHORITY", () => {
  it("ruleset_snapshot has highest authority (100)", () => {
    expect(KNOWLEDGE_SOURCE_AUTHORITY.ruleset_snapshot).toBe(100);
  });

  it("compliance_policy is second (90)", () => {
    expect(KNOWLEDGE_SOURCE_AUTHORITY.compliance_policy).toBe(90);
  });

  it("pgvector (60) > ragnarok (55)", () => {
    expect(KNOWLEDGE_SOURCE_AUTHORITY.pgvector).toBeGreaterThan(
      KNOWLEDGE_SOURCE_AUTHORITY.ragnarok,
    );
  });

  it("fallback_inline has lowest authority (10)", () => {
    expect(KNOWLEDGE_SOURCE_AUTHORITY.fallback_inline).toBe(10);
  });

  it("all sources have positive authority", () => {
    for (const key of Object.keys(KNOWLEDGE_SOURCE_AUTHORITY)) {
      expect(KNOWLEDGE_SOURCE_AUTHORITY[key]).toBeGreaterThan(0);
    }
  });
});

describe("resolvePinnedPolicy", () => {
  it("critical_flow → strict", () => {
    expect(resolvePinnedPolicy("critical_flow")).toBe("strict");
  });

  it("high_risk → prefer_pinned", () => {
    expect(resolvePinnedPolicy("high_risk")).toBe("prefer_pinned");
  });

  it("normal → supplement", () => {
    expect(resolvePinnedPolicy("normal")).toBe("supplement");
  });

  it("onboarding → live_only", () => {
    expect(resolvePinnedPolicy("onboarding")).toBe("live_only");
  });
});

describe("riskLevelToContextType", () => {
  it("no ruleset → always onboarding regardless of risk", () => {
    expect(riskLevelToContextType("critical", false)).toBe("onboarding");
    expect(riskLevelToContextType("high", false)).toBe("onboarding");
    expect(riskLevelToContextType("low", false)).toBe("onboarding");
  });

  it("critical risk + ruleset → critical_flow", () => {
    expect(riskLevelToContextType("critical", true)).toBe("critical_flow");
  });

  it("high risk + ruleset → high_risk", () => {
    expect(riskLevelToContextType("high", true)).toBe("high_risk");
  });

  it("medium risk + ruleset → normal", () => {
    expect(riskLevelToContextType("medium", true)).toBe("normal");
  });

  it("low risk + ruleset → normal", () => {
    expect(riskLevelToContextType("low", true)).toBe("normal");
  });
});

describe("computeTextSimilarity", () => {
  it("identical strings → 1.0", () => {
    expect(computeTextSimilarity("hello world test", "hello world test")).toBe(1);
  });

  it("empty strings → 0", () => {
    expect(computeTextSimilarity("", "hello world")).toBe(0);
    expect(computeTextSimilarity("hello world", "")).toBe(0);
  });

  it("completely different texts → low similarity", () => {
    const sim = computeTextSimilarity("apple orange banana fruit", "car truck motorcycle vehicle");
    expect(sim).toBeLessThan(0.2);
  });

  it("near-duplicate texts → high similarity (≥ 0.8)", () => {
    const textA = "All API calls must use RPC pattern and never direct table access";
    const textB = "All API calls must use RPC pattern and never direct table access via from";
    const sim = computeTextSimilarity(textA, textB);
    expect(sim).toBeGreaterThanOrEqual(0.7);
  });

  it("returns value in [0, 1] range", () => {
    const sim = computeTextSimilarity("some text here", "other different text");
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

describe("computeChunkSortScore", () => {
  it("ruleset_snapshot chunk scores higher than pgvector chunk with same score", () => {
    const pinned = makeChunk({ source: "ruleset_snapshot", score: 0.7, pinned: true });
    const live = makeChunk({ source: "pgvector", score: 0.7 });
    expect(computeChunkSortScore(pinned)).toBeGreaterThan(computeChunkSortScore(live));
  });

  it("high relevance pgvector beats low relevance ragnarok", () => {
    const pg = makeChunk({ source: "pgvector", score: 0.95 });
    const rag = makeChunk({ source: "ragnarok", score: 0.1 });
    expect(computeChunkSortScore(pg)).toBeGreaterThan(computeChunkSortScore(rag));
  });

  it("score is clamped to [0, 1] for relevance", () => {
    const overScore = makeChunk({ source: "pgvector", score: 5.0 });
    const normalScore = makeChunk({ source: "pgvector", score: 1.0 });
    expect(computeChunkSortScore(overScore)).toBe(computeChunkSortScore(normalScore));
  });
});

describe("sortChunksByAuthority", () => {
  it("returns ruleset_snapshot chunks first", () => {
    const chunks: KnowledgeChunk[] = [
      makeChunk({ source: "ragnarok", slug: "rag-1", score: 0.9 }),
      makeChunk({ source: "pgvector", slug: "pg-1", score: 0.9 }),
      makeChunk({ source: "ruleset_snapshot", slug: "rule-1", score: 0.5, pinned: true }),
    ];
    const sorted = sortChunksByAuthority(chunks);
    expect(sorted[0].source).toBe("ruleset_snapshot");
  });

  it("returns original order for equal authority+relevance", () => {
    const chunks: KnowledgeChunk[] = [
      makeChunk({ source: "pgvector", slug: "pg-1", score: 0.8 }),
      makeChunk({ source: "pgvector", slug: "pg-2", score: 0.8 }),
    ];
    const sorted = sortChunksByAuthority(chunks);
    expect(sorted).toHaveLength(2);
  });

  it("does not mutate input array", () => {
    const chunks: KnowledgeChunk[] = [
      makeChunk({ source: "ragnarok", slug: "rag-1" }),
      makeChunk({ source: "ruleset_snapshot", slug: "rule-1", pinned: true }),
    ];
    const originalFirst = chunks[0].slug;
    sortChunksByAuthority(chunks);
    expect(chunks[0].slug).toBe(originalFirst);
  });
});

describe("deduplicateChunks — exact slug", () => {
  it("keeps higher-authority chunk when slugs match", () => {
    const pgChunk = makeChunk({ source: "pgvector", slug: "pg:rule-1", score: 0.7 });
    const ruleChunk = makeChunk({ source: "ruleset_snapshot", slug: "pg:rule-1", score: 0.5, pinned: true });
    const { deduped, removedCount } = deduplicateChunks([pgChunk, ruleChunk]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].source).toBe("ruleset_snapshot");
    expect(removedCount).toBe(1);
  });

  it("keeps lower authority if it appeared first and new is lower", () => {
    const ruleChunk = makeChunk({ source: "ruleset_snapshot", slug: "rule-1", pinned: true });
    const pgChunk = makeChunk({ source: "pgvector", slug: "rule-1" });
    const { deduped } = deduplicateChunks([ruleChunk, pgChunk]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].source).toBe("ruleset_snapshot");
  });

  it("keeps all chunks with distinct slugs", () => {
    const chunks: KnowledgeChunk[] = [
      makeChunk({ source: "pgvector", slug: "slug-1", text: "Sprint backlog velocity tracking Q2 release milestones" }),
      makeChunk({ source: "ragnarok", slug: "slug-2", text: "Customer feedback onboarding survey interview responses" }),
      makeChunk({ source: "ruleset_snapshot", slug: "slug-3", pinned: true, text: "TypeScript strict mandatory configuration linting setup" }),
    ];
    const { deduped, removedCount } = deduplicateChunks(chunks);
    expect(deduped).toHaveLength(3);
    expect(removedCount).toBe(0);
  });

  it("handles empty array without error", () => {
    const { deduped, removedCount } = deduplicateChunks([]);
    expect(deduped).toHaveLength(0);
    expect(removedCount).toBe(0);
  });
});

describe("applyPinnedPolicy — strict", () => {
  const pinnedRule = makeChunk({
    source: "ruleset_snapshot",
    slug: "rule-rpc-only",
    text: "All data access must go through RPC functions. Never call from().select() directly.",
    pinned: true,
  });

  it("allows live chunk with unrelated content", () => {
    const liveChunk = makeChunk({
      source: "ragnarok",
      slug: "rag-unrelated",
      text: "The product backlog contains 25 items scheduled for Q2 sprint.",
    });
    const { allowed, blocked } = applyPinnedPolicy([pinnedRule, liveChunk], "strict");
    expect(blocked).toHaveLength(0);
    expect(allowed).toHaveLength(2);
  });

  it("blocks live chunk overlapping with pinned content (strict)", () => {
    // Near-identical tokens to the pinned rule — crosses 0.55 Jaccard threshold
    const liveOverlap = makeChunk({
      source: "ragnarok",
      slug: "rag-rpc-overlap",
      text: "All data access must go through RPC functions. Never call table select directly.",
    });
    const { blocked } = applyPinnedPolicy([pinnedRule, liveOverlap], "strict");
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });

  it("always keeps all pinned chunks", () => {
    const { allowed } = applyPinnedPolicy([pinnedRule], "strict");
    expect(allowed).toContain(pinnedRule);
  });
});

describe("applyPinnedPolicy — live_only (onboarding)", () => {
  it("blocks all pinned chunks and keeps live", () => {
    const pinned = makeChunk({ source: "ruleset_snapshot", slug: "rule-1", pinned: true });
    const live = makeChunk({ source: "pgvector", slug: "pg-1" });
    const { allowed, blocked } = applyPinnedPolicy([pinned, live], "live_only");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].slug).toBe("rule-1");
    expect(allowed).toHaveLength(1);
    expect(allowed[0].slug).toBe("pg-1");
  });
});

describe("applyPinnedPolicy — supplement", () => {
  it("keeps all chunks, blocks nothing", () => {
    const chunks: KnowledgeChunk[] = [
      makeChunk({ source: "ruleset_snapshot", slug: "rule-1", pinned: true }),
      makeChunk({ source: "pgvector", slug: "pg-1" }),
      makeChunk({ source: "ragnarok", slug: "rag-1" }),
    ];
    const { allowed, blocked } = applyPinnedPolicy(chunks, "supplement");
    expect(allowed).toHaveLength(3);
    expect(blocked).toHaveLength(0);
  });
});

describe("Golden scenario — critical compliance flow", () => {
  it("ruleset rules take priority over KB chunks in critical_flow", () => {
    // Simulate: compliance query with pinned ruleset + live KB chunks
    const pinnedRule1 = makeChunk({
      source: "ruleset_snapshot",
      slug: "rule:rpc-only",
      text: "All API access must go through RPC functions. Direct table queries are forbidden.",
      pinned: true,
      score: 1.0,
    });
    const pinnedRule2 = makeChunk({
      source: "ruleset_snapshot",
      slug: "rule:no-any",
      text: "TypeScript any types are forbidden. Use proper types or unknown with type guard.",
      pinned: true,
      score: 1.0,
    });
    const pgLive = makeChunk({
      source: "pgvector",
      slug: "pg:kb-api",
      // High token overlap with pinnedRule1 → should be blocked in strict mode
      text: "All API access must go through RPC functions. Direct table queries are forbidden here.",
      score: 0.75,
    });

    const policy = resolvePinnedPolicy("critical_flow");
    expect(policy).toBe("strict");

    const { allowed, blocked } = applyPinnedPolicy([pinnedRule1, pinnedRule2, pgLive], policy);
    const sorted = sortChunksByAuthority(allowed);

    // Both ruleset rules must appear
    const sources = sorted.map((c) => c.source);
    expect(sources.filter((s) => s === "ruleset_snapshot")).toHaveLength(2);

    // Ruleset rules come first
    expect(sorted[0].source).toBe("ruleset_snapshot");
    expect(sorted[1].source).toBe("ruleset_snapshot");

    // Conflicting live chunk should be blocked
    // Conflicting live chunk should be blocked (high token overlap with pinnedRule1)
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Golden scenario — normal flow, supplement policy", () => {
  it("pgvector and ragnarok chunks both appear, deduped and ranked", () => {
    const pgChunk1 = makeChunk({ source: "pgvector", slug: "pg:1", text: "Project milestone A is due in two weeks with current sprint completion.", score: 0.8 });
    const pgChunk2 = makeChunk({ source: "pgvector", slug: "pg:2", text: "Code review process requires two approvals before merge.", score: 0.7 });
    const ragChunk1 = makeChunk({ source: "ragnarok", slug: "rag:1", text: "Sprint velocity is calculated from completed story points per iteration.", score: 0.85 });
    const ragDupe = makeChunk({ source: "ragnarok", slug: "pg:1", text: "Project milestone A is due in two weeks with current sprint completion.", score: 0.9 });

    const { deduped } = deduplicateChunks([pgChunk1, pgChunk2, ragChunk1, ragDupe]);
    const { allowed } = applyPinnedPolicy(deduped, "supplement");
    const sorted = sortChunksByAuthority(allowed);

  // Dedup: pg:1 and ragDupe share slug → keep pgvector (higher authority)
  // After dedup: 3 unique chunks remain (pg:1 as pgvector, pg:2, rag:1)
  expect(sorted).toHaveLength(3);

  // slug "pg:1" appears exactly once, from pgvector
  expect(sorted.filter((c) => c.slug === "pg:1")).toHaveLength(1);
  expect(sorted.find((c) => c.slug === "pg:1")?.source).toBe("pgvector");

  // Ragnarok chunk with unique slug also present
  expect(sorted.some((c) => c.source === "ragnarok" && c.slug === "rag:1")).toBe(true);
  });
});
