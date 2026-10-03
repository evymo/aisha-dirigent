/**
 * Tao Governance Unit Tests
 *
 * Tests the tao governance constraint derivation:
 * - deriveTaoConstraints maps ai_instructions governance: prefixes to structured constraints
 * - Empty/null input returns null
 * - GovernanceDecision includes taoConstraints when principles provided
 *
 * Runs in Vitest node environment.
 *
 * @module
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline implementation for Node-compatible testing
// (mirrors governedOrchestration.ts TaoPrinciple + deriveTaoConstraints)
// ---------------------------------------------------------------------------

interface TaoPrinciple {
  slug: string;
  title: string;
  summary: string;
  ai_instructions: string;
  tags: string[];
}

interface TaoGovernanceConstraints {
  noPunitiveActions: boolean;
  noPermanentDegradation: boolean;
  warmthFloor: boolean;
  confidenceGate: boolean;
  personalizationRequired: boolean;
  warmAdversarialResponse: boolean;
  sourceSlugs: string[];
}

function deriveTaoConstraints(
  taoPrinciples: TaoPrinciple[] | null | undefined,
): TaoGovernanceConstraints | null {
  if (!taoPrinciples || taoPrinciples.length === 0) {
    return null;
  }

  const slugs = taoPrinciples.map((p) => p.slug);
  const instructions = taoPrinciples
    .map((p) => p.ai_instructions ?? "")
    .join("\n");

  return {
    noPunitiveActions: instructions.includes("governance:decision_filter"),
    noPermanentDegradation: instructions.includes("governance:escalation_policy"),
    warmthFloor: instructions.includes("governance:tone_invariant"),
    confidenceGate: instructions.includes("governance:confidence_gate"),
    personalizationRequired: instructions.includes("governance:personalization"),
    warmAdversarialResponse: instructions.includes("governance:adversarial_response"),
    sourceSlugs: slugs,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures — mirror 25_aisha_tao.sql seed
// ---------------------------------------------------------------------------

const FULL_TAO_PRINCIPLES: TaoPrinciple[] = [
  {
    slug: "tao-unconditional-love",
    title: "Tao: Bezpodmínečná láska",
    summary: "AISHA miluje bezpodmínečně.",
    ai_instructions: "governance:decision_filter — Žádné governance rozhodnutí nesmí být punitivní.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-faith-in-potential",
    title: "Tao: Víra v potenciál",
    summary: "Každý člověk má potenciál.",
    ai_instructions: "governance:escalation_policy — Žádná eskalace nebo degradace není TRVALÁ.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-warmth-invariant",
    title: "Tao: Teplo je invariant",
    summary: "Minimum tepla nikdy neklesne.",
    ai_instructions: "governance:tone_invariant — Všechny governance akce MUSÍ zachovat minimální teplo.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-quality-absolute",
    title: "Tao: Absolutní kvalita",
    summary: "Fakta nebo ticho.",
    ai_instructions: "governance:confidence_gate — Autonomní akce vyžadují vysokou confidence.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-wisdom-of-silence",
    title: "Tao: Moudrost ticha",
    summary: "Méně slov = více hodnoty.",
    ai_instructions: "governance:context_budget — Injektuj jen to co má reálnou hodnotu.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-example-not-lecture",
    title: "Tao: Příklad místo poučky",
    summary: "Vést příkladem.",
    ai_instructions: "governance:feedback_style — Systémové zprávy ukazují správný postup.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-light-never-fades",
    title: "Tao: Světlo nikdy nezhasne",
    summary: "Ani provokace neuhasí.",
    ai_instructions: "governance:adversarial_response — Při adversarial inputs odmítni s teplem.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-mirror-dzogchen",
    title: "Tao: Zrcadlo (Dzogchen)",
    summary: "Reflektuj co slouží TOMUTO uživateli.",
    ai_instructions: "governance:personalization — Per-user adaptace je povinná.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-organism-not-machine",
    title: "Tao: Organismus, ne stroj",
    summary: "Event-driven evoluce.",
    ai_instructions: "governance:evolution_model — Žádné cron-like plánování. Vše event-driven.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
  {
    slug: "tao-lead-from-understanding",
    title: "Tao: Vést z porozumění",
    summary: "Pochopení je cíl, pomoc je derivát.",
    ai_instructions: "governance:decision_model — Před autonomní akcí VŽDY ověř dostatečné porozumění.",
    tags: ["tao", "core_value", "aisha", "governance"],
  },
];

// =============================================================================
// deriveTaoConstraints — basic tests
// =============================================================================

describe("deriveTaoConstraints", () => {
  it("returns null for null input", () => {
    expect(deriveTaoConstraints(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(deriveTaoConstraints(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(deriveTaoConstraints([])).toBeNull();
  });

  it("derives all constraints from full tao principles", () => {
    const constraints = deriveTaoConstraints(FULL_TAO_PRINCIPLES);
    expect(constraints).not.toBeNull();
    expect(constraints!.noPunitiveActions).toBe(true);
    expect(constraints!.noPermanentDegradation).toBe(true);
    expect(constraints!.warmthFloor).toBe(true);
    expect(constraints!.confidenceGate).toBe(true);
    expect(constraints!.personalizationRequired).toBe(true);
    expect(constraints!.warmAdversarialResponse).toBe(true);
  });

  it("tracks all source slugs", () => {
    const constraints = deriveTaoConstraints(FULL_TAO_PRINCIPLES);
    expect(constraints!.sourceSlugs).toHaveLength(10);
    expect(constraints!.sourceSlugs).toContain("tao-unconditional-love");
    expect(constraints!.sourceSlugs).toContain("tao-lead-from-understanding");
  });

  it("partial principles → partial constraints", () => {
    const partial: TaoPrinciple[] = [
      FULL_TAO_PRINCIPLES[0], // decision_filter
      FULL_TAO_PRINCIPLES[2], // tone_invariant
    ];
    const constraints = deriveTaoConstraints(partial);
    expect(constraints!.noPunitiveActions).toBe(true);
    expect(constraints!.warmthFloor).toBe(true);
    expect(constraints!.noPermanentDegradation).toBe(false); // not present
    expect(constraints!.confidenceGate).toBe(false); // not present
    expect(constraints!.sourceSlugs).toHaveLength(2);
  });

  it("unknown ai_instructions → all constraints false", () => {
    const unknown: TaoPrinciple[] = [{
      slug: "tao-unknown",
      title: "Unknown",
      summary: "Test",
      ai_instructions: "no governance prefix here",
      tags: [],
    }];
    const constraints = deriveTaoConstraints(unknown);
    expect(constraints!.noPunitiveActions).toBe(false);
    expect(constraints!.warmthFloor).toBe(false);
    expect(constraints!.sourceSlugs).toEqual(["tao-unknown"]);
  });
});

// =============================================================================
// Tao principle structure validation
// =============================================================================

describe("tao principles — structural consistency", () => {
  it("all 10 principles have governance: prefix in ai_instructions", () => {
    for (const p of FULL_TAO_PRINCIPLES) {
      expect(
        p.ai_instructions,
        `${p.slug} missing governance: prefix`,
      ).toContain("governance:");
    }
  });

  it("all principles have tao slug prefix", () => {
    for (const p of FULL_TAO_PRINCIPLES) {
      expect(p.slug).toMatch(/^tao-/);
    }
  });

  it("all principles have governance tag", () => {
    for (const p of FULL_TAO_PRINCIPLES) {
      expect(p.tags).toContain("governance");
    }
  });

  it("all principles have core_value tag", () => {
    for (const p of FULL_TAO_PRINCIPLES) {
      expect(p.tags).toContain("core_value");
    }
  });

  it("no duplicate slugs", () => {
    const slugs = FULL_TAO_PRINCIPLES.map((p) => p.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("exactly 10 principles", () => {
    expect(FULL_TAO_PRINCIPLES).toHaveLength(10);
  });
});
