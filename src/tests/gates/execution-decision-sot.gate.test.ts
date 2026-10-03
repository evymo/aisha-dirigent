/**
 * E0.1 — AishaExecutionDecision SoT architecture gate.
 *
 * Locks the foundation invariant of the "AISHA Orchestration Authority" sprint:
 * there is ONE source of truth for an execution decision, the `runtime` axis is
 * a NEW discriminant ORTHOGONAL to the model-transport `backend_kind`, and no
 * reflection node re-declares the decision shape inline.
 *
 * Why a gate (static, no DB/network): the failure mode is silent architectural
 * drift — a node quietly re-introducing an inline `ClowBackend` or a second
 * mapBackendKindToProvider, which is exactly how "every node a small sovereign"
 * crept in originally. The gate makes the SoT unbypassable, not merely
 * conventional. Reads only files; safe for pre-push.
 *
 * Pairs with `llm-gateway-dispatch.gate.test.ts` (which asserts the generator
 * honors the resolver) — together they enforce E0.1 + E0.2.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DECISION_TS = "services/svc-ai-chat/src/reflection/decision.ts";
const GENERATOR_TS = "services/svc-ai-chat/src/reflection/nodes/generator.ts";
const PROVIDER_REGISTRY_TABLE =
  "aisha/db/sql/tables/ai_provider_registry.sql";
const REFLECTION_NODES_DIR = "services/svc-ai-chat/src/reflection/nodes";
const LLM_NODES = ["generator.ts", "critic.ts", "corrector.ts", "occipitum.ts"];

describe("E0.1 — AishaExecutionDecision SoT", () => {
  // ───────────────────────────────────────────────────────────────────────
  // 1. The SoT module exists and exports the foundation symbols
  // ───────────────────────────────────────────────────────────────────────
  describe("reflection/decision.ts is the single source of truth", () => {
    it("the module file exists", () => {
      expect(
        existsSync(join(ROOT, DECISION_TS)),
        "E0.1 requires a shared decision module at reflection/decision.ts",
      ).toBe(true);
    });

    it("exports AishaExecutionDecision (type) + AishaExecutionDecisionSchema (zod)", () => {
      const ts = read(DECISION_TS);
      expect(ts, "must export the AishaExecutionDecision type").toMatch(
        /export\s+(?:type|interface)\s+AishaExecutionDecision\b/,
      );
      expect(ts, "must export a Zod schema for runtime validation").toMatch(
        /export\s+const\s+AishaExecutionDecisionSchema\b/,
      );
    });

    it("exports the resolveModelWithClow() helper (the one resolver-first chokepoint)", () => {
      const ts = read(DECISION_TS);
      // async-tolerant: resolveModelWithClow is async since the slot fallback path awaits
      // soulforge's live slot resolve (resolveSlotModel). The chokepoint is still exported.
      expect(ts).toMatch(/export\s+(?:async\s+)?function\s+resolveModelWithClow\b/);
    });

    it("exports mapBackendKindToProvider() (moved out of generator.ts)", () => {
      const ts = read(DECISION_TS);
      expect(ts).toMatch(/export\s+function\s+mapBackendKindToProvider\b/);
    });

    it("declares both axis value-sets as exported constants (AISHA_RUNTIMES, BACKEND_KINDS)", () => {
      const ts = read(DECISION_TS);
      expect(ts, "runtime axis value-set must be enumerable").toMatch(
        /export\s+const\s+AISHA_RUNTIMES\b/,
      );
      expect(ts, "backend_kind axis value-set must be enumerable").toMatch(
        /export\s+const\s+BACKEND_KINDS\b/,
      );
    });

    it("the runtime axis carries openclaw + hermes (the executor discriminants the thesis names)", () => {
      const ts = read(DECISION_TS);
      expect(ts).toMatch(/['"]openclaw['"]/);
      expect(ts).toMatch(/['"]hermes['"]/);
      expect(ts).toMatch(/['"]direct_llm['"]/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Orthogonality — runtime is NOT backend_kind (the crux)
  // ───────────────────────────────────────────────────────────────────────
  describe("runtime axis is orthogonal to backend_kind", () => {
    it("the ai_provider_registry backend_kind CHECK does NOT contain runtime-executor values", () => {
      // backend_kind is a model-transport concept. If 'openclaw'/'hermes'/
      // 'human'/'workflow' ever appear in its CHECK constraint, the two axes
      // have been re-collapsed — the exact mistake E0.1 prevents.
      const sql = read(PROVIDER_REGISTRY_TABLE);
      const checkBlock =
        sql.match(/backend_kind[\s\S]{0,300}?CHECK[\s\S]{0,300}?\)/i)?.[0] ??
        sql;
      for (const runtime of ["openclaw", "hermes", "human", "workflow"]) {
        expect(
          checkBlock,
          `backend_kind CHECK must not contain runtime value '${runtime}' — runtime is a separate axis`,
        ).not.toMatch(new RegExp(`['"]${runtime}['"]`));
      }
    });

    it("decision.ts does not alias runtime to backend_kind (no `runtime = backend_kind`)", () => {
      const ts = read(DECISION_TS);
      // The two fields must be independent on AishaExecutionDecision.
      expect(ts).toMatch(/\bruntime\b/);
      expect(ts).toMatch(/\bbackend_kind\b/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. No inline re-declaration anywhere in the reflection layer
  // ───────────────────────────────────────────────────────────────────────
  describe("no node re-declares the decision shape inline (single-source)", () => {
    it("generator.ts no longer declares `interface ClowBackend`", () => {
      const ts = read(GENERATOR_TS);
      expect(
        ts,
        "ClowBackend must be promoted to reflection/decision.ts, not declared inline in generator.ts",
      ).not.toMatch(/\binterface\s+ClowBackend\b/);
    });

    it("generator.ts no longer declares its own mapBackendKindToProvider", () => {
      const ts = read(GENERATOR_TS);
      expect(
        ts,
        "mapBackendKindToProvider must live only in decision.ts",
      ).not.toMatch(/function\s+mapBackendKindToProvider\b/);
    });

    it("no reflection node declares `interface ClowBackend` (only decision.ts may)", () => {
      for (const f of LLM_NODES) {
        const ts = read(join(REFLECTION_NODES_DIR, f));
        expect(
          ts,
          `${f} must import the decision shape from decision.ts, not redeclare it`,
        ).not.toMatch(/\binterface\s+ClowBackend\b/);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. E0.2 — ALL four reflection LLM nodes honor the resolver
  //    (generator's honor is also covered by llm-gateway-dispatch.gate.test.ts;
  //     here we extend it to critic/corrector/occipitum — the 3 ex-sovereigns)
  // ───────────────────────────────────────────────────────────────────────
  describe("E0.2 — every reflection LLM node routes through the shared resolver-first dispatch", () => {
    for (const f of LLM_NODES) {
      it(`${f} routes through resolveModelWithClow/dispatchDecision (no raw self-resolve)`, () => {
        const ts = read(join(REFLECTION_NODES_DIR, f));
        // dispatchDecision is the resolver-first entry point: it wraps
        // resolveModelWithClow AND journals the decision (E0.1b). Either name
        // satisfies "no node picks its own model".
        expect(
          ts,
          `${f} must obtain its model via the shared resolver helper (resolveModelWithClow or dispatchDecision)`,
        ).toMatch(/(resolveModelWithClow|dispatchDecision)\s*\(/);
        // Anti-regression: the old self-sovereign pattern
        // `cfg.model_override ?? resolveSlotModel(...)` must be gone.
        expect(
          ts,
          `${f} must not re-derive the model itself — that bypasses AISHA's authority`,
        ).not.toMatch(/model_override\s*as\s+string\s*\)\s*\?\?\s*resolveSlotModel/);
      });
    }
  });
});
