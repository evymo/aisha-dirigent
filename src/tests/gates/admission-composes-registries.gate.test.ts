/**
 * E0 — Admission-composes-registries gate.
 *
 * Locks the capability-availability shape of the pre-resolver admission layer:
 * `fn_admit_clow` MUST derive its verdict from REGISTRIES + POLICY, never from a
 * maintained allow-list.
 *
 *   - spend   axis → fn_authorize_task_spend   (thresholds; reuse)
 *   - runtime axis → fn_runtime_available      (DERIVED: is_enabled + adapter)
 *   - risk    axis → fn_compute_clow_risk × ai_risk_policies (computed → threshold)
 *
 * Why a gate (static, file-only — no DB/network, safe for pre-push): the failure
 * mode is silent governance drift back to the original allow-list shape — a
 * `governance_flags.allow_runtime` jsonb array of permitted names checked with
 * `@>` array-membership, plus the `fn_resolve_governance_flag` /
 * `_admit_capability_axis` plumbing that read it. That shape is a maintained list
 * of permitted entities: a security hole (anything off the list is silently
 * mis-judged) and a hardcoded thing that MUST NOT live anywhere. Availability is
 * instead DERIVED — an entity is usable iff its OWN registry row is enabled with a
 * live adapter (mirrors the ai_provider_registry resolver filter); a clow's needs
 * are matched against the chosen entity's DECLARED capabilities; governance is a
 * computed risk → ai_risk_policies threshold, not list membership.
 *
 * The gate makes the registries+policy derivation unbypassable, not merely
 * conventional. Pairs with `execution-decision-sot.gate.test.ts` (E0.1 SoT) and
 * `ai-spend-governance.gate.test.ts` (the spend axis it reuses).
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
// Scan real CODE, not comments: a SQL comment legitimately DOCUMENTS the absence
// of the allow-list shape ("there is no governance_flags lookup, no @>
// array-membership"). Penalising that prose would force removing the very
// documentation of the design decision. Strip block + line comments first.
const stripSqlComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
const code = (rel: string) => stripSqlComments(read(rel));

const ADMIT_SQL = "aisha/db/sql/functions/fn_admit_clow.sql";

describe("E0 — admission composes registries + policy (not allow-lists)", () => {
  // ───────────────────────────────────────────────────────────────────────
  // 1. Admission DERIVES from registries + policy — the three derivation seams.
  // ───────────────────────────────────────────────────────────────────────
  describe("fn_admit_clow derives its verdict from registries + policy", () => {
    // Each expected reference is a derivation seam the composer MUST call/read,
    // not a permitted-name list: a registry/policy predicate that governs itself.
    const REQUIRED_REFERENCES: ReadonlyArray<readonly [string, string]> = [
      [
        "fn_authorize_task_spend",
        "spend axis must reuse the spend-policy authorizer (thresholds, not a list)",
      ],
      [
        "fn_runtime_available",
        "runtime axis must derive availability from the registry predicate (is_enabled + adapter), not from a permitted-runtime list",
      ],
      [
        "fn_compute_clow_risk",
        "risk must be COMPUTED from the clow (criticality, side-effect class), not read off a list",
      ],
      [
        "ai_risk_policies",
        "governance must be a computed-risk → threshold policy, not membership in a permitted-entity list",
      ],
    ];

    for (const [ref, why] of REQUIRED_REFERENCES) {
      it(`references ${ref}`, () => {
        const sql = code(ADMIT_SQL);
        expect(sql, why).toContain(ref);
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Admission contains NO maintained allow-list — the forbidden shape.
  // ───────────────────────────────────────────────────────────────────────
  describe("fn_admit_clow contains no allow-list machinery", () => {
    // Each forbidden token is a fingerprint of the maintained-list design:
    // a governance_flags row whose VALUE is a list of permitted names, the
    // resolver that reads it, the per-axis helper that gated on it, and the
    // jsonb array-membership operator (@>) used to test "is X in the permitted
    // set". A per-entity is_enabled / supports_X flag is NOT an allow-list (the
    // entity governs itself) and is intentionally NOT matched here.
    const FORBIDDEN_TOKENS: ReadonlyArray<readonly [string, string]> = [
      [
        "governance_flags",
        "the governance_flags table held jsonb arrays of permitted names (allow_runtime/allow_internet/...) — a maintained allow-list",
      ],
      [
        "fn_resolve_governance_flag",
        "this resolver read the allow_* lists out of governance_flags — the allow-list lookup must be gone",
      ],
      [
        "_admit_capability_axis",
        "this helper gated capabilities on the allow_* flags — replaced by derived availability + computed risk",
      ],
    ];

    for (const [token, why] of FORBIDDEN_TOKENS) {
      it(`does NOT contain ${token}`, () => {
        const sql = code(ADMIT_SQL);
        expect(sql, why).not.toContain(token);
      });
    }

    it("does NOT use jsonb array-membership (@>) to test a permission", () => {
      // `v_allowed_runtimes @> to_jsonb(v_runtime)` was the literal "is the
      // requested runtime IN the permitted set" check. Capability-availability
      // derives the answer from the entity's own registry row instead, so the
      // containment operator has no place in the admission composer.
      const sql = code(ADMIT_SQL);
      expect(
        sql,
        "@> array-membership is allow-list testing — availability must be derived, not checked against a permitted set",
      ).not.toContain("@>");
    });
  });
});
