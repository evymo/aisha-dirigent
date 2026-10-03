/**
 * Resolver contract tests — static analysis of aisha_resolve_clow_backend.sql
 *
 * The resolver is a SECURITY DEFINER PG function that ranks providers from
 * `ai_provider_registry`. These tests assert SQL-level invariants without
 * running a live DB:
 *
 *   - llm_gateway is treated like any other backend (no WHERE exclusion,
 *     no zero-weight branch, no special-case skip)
 *   - score formula columns are all defined on ai_provider_registry +
 *     ai_model_registry SoT (sanity vs the SoT)
 *   - candidate output JSON shape matches what generator/openclaw_resolve_clow
 *     reads (`provider_slug`, `model_id`, `backend_kind`, `endpoint_url`,
 *     `auth_env_var`, `strategy`)
 *   - no-match returns resolved:false WITHOUT a substitute fallback (owner
 *     directive "zadne fallbacky" — an empty derived set is a real no-capable-
 *     provider condition the caller surfaces/fails-loud on, never masks)
 *
 * Run via vitest gates config (offline; reads SQL files only).
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const RESOLVER_SQL_PATH = "aisha/db/sql/functions/aisha_resolve_clow_backend.sql";
const RESOLVER_SQL = readFileSync(join(ROOT, RESOLVER_SQL_PATH), "utf8");
const PROVIDER_TABLE_SQL = readFileSync(
  join(ROOT, "aisha/db/sql/tables/ai_provider_registry.sql"),
  "utf8",
);
const MODEL_TABLE_SQL = readFileSync(
  join(ROOT, "aisha/db/sql/tables/ai_model_registry.sql"),
  "utf8",
);

describe("aisha_resolve_clow_backend — resolver contract", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Function metadata
  // ─────────────────────────────────────────────────────────────────────────
  describe("function safety + signature", () => {
    it("is SECURITY DEFINER (so anon/authenticated can call it)", () => {
      expect(RESOLVER_SQL).toMatch(/SECURITY DEFINER/i);
    });

    it("SETs search_path TO 'public' (no privilege escalation via search_path)", () => {
      expect(RESOLVER_SQL).toMatch(/SET\s+search_path\s+TO\s+['"]public['"]?/i);
    });

    it("returns jsonb (per project RPC convention)", () => {
      expect(RESOLVER_SQL).toMatch(/RETURNS\s+jsonb/i);
    });

    it("declared as STABLE (no side effects — same args → same answer)", () => {
      // STABLE allows the planner to fold repeated calls in a single query;
      // important for routing decisions used inside views or other functions.
      expect(RESOLVER_SQL).toMatch(/\bSTABLE\b/i);
    });

    it("input parameter is p_clow jsonb", () => {
      expect(RESOLVER_SQL).toMatch(/p_clow\s+jsonb/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Backend-kind freedom — no implicit exclusion of llm_gateway
  // ─────────────────────────────────────────────────────────────────────────
  describe("backend_kind freedom (resolver treats gateway as a peer)", () => {
    it("WHERE clause does not blacklist llm_gateway", () => {
      const patterns = [
        /backend_kind\s+NOT IN\s*\([^)]*llm_gateway[^)]*\)/i,
        /backend_kind\s*<>\s*['"]llm_gateway['"]/i,
        /backend_kind\s*!=\s*['"]llm_gateway['"]/i,
      ];
      for (const pat of patterns) {
        expect(
          RESOLVER_SQL,
          `Resolver excludes llm_gateway via WHERE pattern: ${pat}`,
        ).not.toMatch(pat);
      }
    });

    it("score formula does not zero out llm_gateway", () => {
      expect(
        RESOLVER_SQL,
        "Resolver must not zero score on backend_kind='llm_gateway'",
      ).not.toMatch(
        /backend_kind\s*=\s*['"]llm_gateway['"][\s\S]{0,80}THEN\s+0(?:\.0+)?\s+ELSE/i,
      );
    });

    it("score formula does not bias against gateway (negative bonus)", () => {
      // Anti-pattern: subtracting from score when backend_kind=llm_gateway.
      // `- CASE WHEN backend_kind='llm_gateway' THEN ... END`
      expect(
        RESOLVER_SQL,
        "Resolver must not subtract score for llm_gateway",
      ).not.toMatch(/-\s*CASE[\s\S]{0,80}llm_gateway/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Candidate output JSON — fields the executor needs
  // ─────────────────────────────────────────────────────────────────────────
  describe("candidate output shape (what executor reads)", () => {
    // The generator + openclaw_resolve_clow node read these fields.
    // If they're renamed or dropped, the executor crashes silently.
    const REQUIRED_FIELDS = [
      "provider_slug",
      "model_id",
      "backend_kind",
      "endpoint_url",
      "auth_env_var",
      "strategy",
    ];

    for (const field of REQUIRED_FIELDS) {
      it(`candidate JSON includes '${field}' (executor depends on it)`, () => {
        // jsonb_build_object('provider_slug', p.slug, ...) form
        expect(
          RESOLVER_SQL,
          `Resolver candidate JSON missing '${field}' — executor cannot dispatch`,
        ).toMatch(new RegExp(`['"]${field}['"]`));
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Fallback object — never leaves executor empty-handed
  // ─────────────────────────────────────────────────────────────────────────
  describe("no-match fails loud — no substitution", () => {
    it("does NOT embed a fallback backend/model (owner: no fallbacks — masking non-functionality weakens reliability)", () => {
      // A fallback here ("if nothing matches, use direct_cloud anyway") silently
      // hid a fully-broken resolver for the lifetime of the %.2f format() bug.
      // The no-match branch must carry only resolved/reasoning/candidates so the
      // caller surfaces the real "no capable + available + serviceable provider".
      expect(
        RESOLVER_SQL,
        "resolved:false must NOT carry a substitute 'fallback' backend_kind — surface the no-match, never mask it",
      ).not.toMatch(/['"]fallback['"][\s\S]{0,200}backend_kind/);
    });

    it("returns 'resolved: false' so the caller can detect + surface the no-match state", () => {
      expect(RESOLVER_SQL).toMatch(/['"]resolved['"][\s\S]{0,50}false/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Schema sanity — referenced columns exist in SoT
  // ─────────────────────────────────────────────────────────────────────────
  describe("schema references match SoT tables", () => {
    it("provider table has all columns the resolver queries", () => {
      // Columns the resolver reads from ai_provider_registry
      const cols = [
        "slug",
        "backend_kind",
        "endpoint_url",
        "auth_env_var",
        "supports_batch",
        "cost_class",
        "is_enabled",
        "last_health_status",
      ];
      for (const col of cols) {
        expect(
          PROVIDER_TABLE_SQL,
          `ai_provider_registry SoT missing column '${col}' — resolver references it`,
        ).toMatch(new RegExp(`\\b${col}\\b`, "i"));
      }
    });

    it("model table has all columns the resolver queries", () => {
      const cols = [
        "id",
        "model_id",
        "is_available",
        "is_deprecated",
        "is_function_calling",
        "is_vision",
      ];
      for (const col of cols) {
        expect(
          MODEL_TABLE_SQL,
          `ai_model_registry SoT missing column '${col}'`,
        ).toMatch(new RegExp(`\\b${col}\\b`, "i"));
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Score formula transparency — coefficients explicit (no magic)
  // ─────────────────────────────────────────────────────────────────────────
  describe("score formula transparency", () => {
    it("benchmark weight is explicit and operator-reviewable (named policy column, not a magic literal)", () => {
      // The weight was a decimal literal (0.55); it is now the NAMED, operator-tunable
      // ai_resolver_policy column v_pol.bench_weight — strictly MORE transparent (reviewable +
      // tunable in one SoT), not less. The transparency invariant holds; the form moved to policy.
      expect(RESOLVER_SQL).toMatch(/overall_score[\s\S]{0,40}\*\s*v_pol\.bench_weight/);
    });

    it("local-backend bonus is conditional on v_allow_local (never auto-applied)", () => {
      // Anti-pattern: applying the local bonus unconditionally would make
      // Ollama/vLLM win every score regardless of operator preference.
      expect(RESOLVER_SQL).toMatch(/local_ollama['"]?,\s*['"]?local_vllm[\s\S]{0,80}AND\s+v_allow_local/i);
    });

    it("cost class filter is named (v_cost_class_filter), not a literal", () => {
      // If someone hardcodes cost_class='budget' the filter is operator-
      // invisible. Variable name forces it through the caller's budget.
      expect(RESOLVER_SQL).toMatch(/v_cost_class_filter/);
    });
  });
});
