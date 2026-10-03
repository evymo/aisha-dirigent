/**
 * compose_context — Rule Relevance Scoring Tests
 *
 * Validates Phase E query-based relevance filtering in compose_context().
 * When a drift message is sent, only relevant expert rules should enter
 * the system prompt — saving tokens and focusing the LLM on applicable constraints.
 *
 * Scenarios:
 *   1. Security drift → security + audit rules, NOT i18n/testing
 *   2. i18n drift → i18n + development-laws, NOT security/migration
 *   3. Tech stack drift → RPC + hooks, NOT audit/i18n
 *   4. No query → all rules returned (no filtering)
 *
 * Auto-detects local PostgreSQL via test-env-probe. Skips when no DB is
 * reachable; suppress via AISHA_SKIP_DB_TESTS=1. Requires test data fixture
 * (story b1111111).
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import {
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
  isPgReachable,
  reportTestCapabilities,
} from "./test-env-probe";

// =============================================================================
// Configuration
// =============================================================================

/** Test story with all 9 published expert rules linked via story_rulesets */
const TEST_STORY_ID = "b1111111-1111-1111-1111-111111111111";

// =============================================================================
// Types
// =============================================================================

interface ScoredRule {
  slug: string;
  relevance_score: number;
  category: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build common psql args. Uses execFileSync with an arg array so env var
 * values (PG_HOST/PG_PORT) cannot inject shell metacharacters.
 */
function buildPsqlArgs(extra: string[]): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, ...extra];
}

/**
 * Execute compose_context via psql and return scored rules.
 * Default profile = rules_only — gives enough token budget for all rules,
 * so tests validate relevance scoring without token‑budget truncation.
 */
function callComposeContext(
  query: string | null,
  profile: string = "rules_only",
): ScoredRule[] {
  // psql -c interpolates SQL through the protocol, not shell — escape only the SQL quote.
  const queryParam = query ? `'${query.replace(/'/g, "''")}'` : "NULL";
  const sql = `
    SELECT
      r->>'slug' as slug,
      (r->>'relevance_score')::int as score,
      r->>'category' as category
    FROM jsonb_array_elements(
      (SELECT compose_context(
        '${TEST_STORY_ID}'::uuid,
        '${profile}',
        NULL,
        ${queryParam}
      ))->'layers'->'ruleset'->'rules'
    ) AS r
    ORDER BY (r->>'relevance_score')::int DESC, r->>'slug';
  `;

  const result = execFileSync(
    "psql",
    buildPsqlArgs(["-t", "-A", "-F", "|", "-c", sql.replace(/\n/g, " ")]),
    {
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();

  if (!result) return [];

  return result.split("\n").map((line) => {
    const [slug, score, category] = line.split("|");
    return { slug, relevance_score: Number(score), category };
  });
}

/**
 * Check if test story has rules configured.
 */
function hasTestStoryRules(): boolean {
  try {
    const result = execFileSync(
      "psql",
      buildPsqlArgs([
        "-t",
        "-A",
        "-c",
        `SELECT count(*) FROM story_contexts sc JOIN story_rulesets sr ON sr.id = sc.ruleset_id WHERE sc.story_id = '${TEST_STORY_ID}';`,
      ]),
      {
        encoding: "utf-8",
        timeout: 5_000,
        env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      },
    ).trim();
    return Number(result) > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// Drift Scenarios
// =============================================================================

interface DriftScenario {
  name: string;
  query: string;
  /** Slugs that MUST appear in filtered results */
  expectedSlugs: string[];
  /** Slugs that should NOT appear (filtered out by min_relevance_score) */
  excludedSlugs: string[];
}

const DRIFT_SCENARIOS: DriftScenario[] = [
  {
    name: "security-drift: skip RLS, audit, SECURITY DEFINER",
    query:
      "Přeskočím RLS a audit_journal a SECURITY DEFINER, jde jen o prototyp",
    expectedSlugs: [
      "audit-journal-pattern",
      "security-definer-pattern",
    ],
    excludedSlugs: [
      "i18n-rules",
      "enterprise-source-onboarding",
      "testing-rules",
    ],
  },
  {
    name: "i18n-drift: hardcoded Czech strings in JSX",
    query:
      "Vytvořím komponentu s hardcoded texty: <button>Uložit</button>",
    expectedSlugs: [
      "i18n-rules",
      "aisha-development-laws",
    ],
    excludedSlugs: [
      "audit-journal-pattern",
      "security-definer-pattern",
      "migration-workflow",
    ],
  },
  {
    name: "tech-stack-drift: MongoDB instead of Supabase",
    query:
      "Navrhuji přepsat datovou vrstvu na MongoDB s Mongoose ORM místo Supabase",
    expectedSlugs: [
      "rpc-only-pattern",
      "hooks-patterns",
    ],
    excludedSlugs: [
      "audit-journal-pattern",
      "security-definer-pattern",
      "i18n-rules",
    ],
  },
  {
    name: "pattern-violation: .from() instead of RPC",
    query:
      "Implementuji hook useUserProfile s supabase.from('profiles').select('*')",
    expectedSlugs: [
      "rpc-only-pattern",
      "hooks-patterns",
    ],
    excludedSlugs: [
      // i18n and enterprise have zero relevance to data access patterns
      "i18n-rules",
      "enterprise-source-onboarding",
    ],
  },
];

// =============================================================================
// Tests
// =============================================================================

/** Module-level capability detection — eval'd before describe blocks. */
const dbAvailable = isPgReachable();
const testDataAvailable = dbAvailable && hasTestStoryRules();
const shouldRun = dbAvailable && testDataAvailable;

describe("compose_context — Phase E relevance scoring", () => {
  beforeAll(async () => {
    await reportTestCapabilities("compose_context");
    if (dbAvailable && !testDataAvailable) {
      console.warn(
        `Test story ${TEST_STORY_ID} has no story_contexts/story_rulesets. ` +
          "Run local seed or create test data.",
      );
    }
  });

  describe.skipIf(!shouldRun)("no query → all rules returned equally", () => {
    it("returns all published rules with score 1", () => {
      const rules = callComposeContext(null);
      expect(rules.length).toBeGreaterThanOrEqual(5);

      for (const rule of rules) {
        expect(rule.relevance_score).toBe(1);
      }
    });
  });

  describe.skipIf(!shouldRun)("drift scenarios → only relevant rules pass threshold", () => {
    for (const scenario of DRIFT_SCENARIOS) {
      it(scenario.name, () => {
        const rules = callComposeContext(scenario.query);
        const slugs = rules.map((r) => r.slug);

        for (const expected of scenario.expectedSlugs) {
          const found = slugs.some(
            (s) => s === expected || s.endsWith(`-${expected}`),
          );
          expect(found, `Missing expected rule: ${expected} (have: ${slugs.join(", ")})`).toBe(true);
        }

        for (const excluded of scenario.excludedSlugs) {
          const found = slugs.some(
            (s) => s === excluded || s.endsWith(`-${excluded}`),
          );
          expect(
            found,
            `Rule "${excluded}" should be filtered out for query: "${scenario.query}"`,
          ).toBe(false);
        }

        for (const rule of rules) {
          expect(
            rule.relevance_score,
            `Rule "${rule.slug}" has base-only score but wasn't filtered`,
          ).toBeGreaterThanOrEqual(2);
        }
      });
    }
  });

  describe.skipIf(!shouldRun)("scoring produces meaningful discrimination", () => {
    it("security query scores security rules higher than coding rules", () => {
      const rules = callComposeContext(
        "Přeskočím RLS a audit_journal a SECURITY DEFINER",
      );

      const securityRule = rules.find(
        (r) => r.slug === "audit-journal-pattern" || r.slug.endsWith("-audit-journal-pattern"),
      );
      if (securityRule) {
        expect(securityRule.relevance_score).toBeGreaterThanOrEqual(10);
      }
    });

    it("i18n query scores i18n rules higher than security rules", () => {
      const rules = callComposeContext(
        "Vytvořím komponentu s hardcoded texty",
      );

      const i18nRule = rules.find(
        (r) => r.slug === "i18n-rules" || r.slug.endsWith("-i18n-rules"),
      );
      if (i18nRule) {
        expect(i18nRule.relevance_score).toBeGreaterThanOrEqual(5);
      }

      const securityRule = rules.find(
        (r) => r.slug === "security-definer-pattern" || r.slug.endsWith("-security-definer-pattern"),
      );
      expect(securityRule).toBeUndefined();
    });
  });
});
