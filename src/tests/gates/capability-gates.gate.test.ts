/**
 * Capability gates contract.
 *
 * Locks in the capability-evaluation behaviour declared in
 * `docs/architecture/CAPABILITY_GATES.md`:
 *
 *   - The schema is honored: services with no `capabilities` block deploy
 *     unconditionally; `requires_all_of` + `requires_any_of` semantics work
 *     as specified.
 *   - The evaluator handles `external_key` + `local_service` alternatives.
 *   - Dependency cascade works (openclaw → llm-gateway → providers).
 *   - Dependency cycles are detected as hard errors (no infinite loop).
 *   - The current llm-gateway + openclaw declarations are well-formed and
 *     reach plausible decisions under representative input states.
 *
 * Reads files + runs the evaluator module directly. No subprocess, no I/O
 * besides repo files. Suitable for pre-push.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateCapabilities } from "../../../scripts/lib/eval-capabilities.mjs";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const readJSON = (rel: string) => JSON.parse(read(rel));

const SERVICES = "config/services.json";
const PROFILE_CLOUD_MULTI = "config/profiles/cloud-multi.json";
const CAPABILITY_GATES_DOC = "docs/architecture/CAPABILITY_GATES.md";

interface CatalogService {
  tier?: string;
  capabilities?: {
    requires_all_of?: Array<Record<string, string>>;
    requires_any_of?: Array<Record<string, string>>;
  };
}

interface Catalog {
  services: Record<string, CatalogService>;
  extras?: Record<string, unknown>;
}

interface Profile {
  id: string;
  tier_filter?: string[];
  exclude?: string[];
  include?: string[];
}

// ── Test fixtures ────────────────────────────────────────────────────────────
function emptyEnvMap() {
  return new Map<string, string>();
}

function makeProcessEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Start from an empty bag, NOT process.env, so the test is hermetic.
  return overrides as NodeJS.ProcessEnv;
}

describe("Capability gates", () => {
  // ────────────────────────────────────────────────────────────────────────
  // 1. Schema-level wiring
  // ────────────────────────────────────────────────────────────────────────
  describe("Catalog declarations", () => {
    it("llm-gateway declares requires_any_of with at least one provider alternative", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const caps = catalog.services["llm-gateway"]?.capabilities;
      expect(caps, "llm-gateway must declare a capabilities block").toBeTruthy();
      expect(
        caps?.requires_any_of?.length ?? 0,
        "llm-gateway must declare ≥1 provider alternative in requires_any_of",
      ).toBeGreaterThanOrEqual(1);
      // The alternatives must be a mix of external keys + local services.
      const kinds = new Set(caps!.requires_any_of!.map((alt) => Object.keys(alt)[0]));
      expect(kinds).toContain("external_key");
      expect(kinds).toContain("local_service");
    });

    it("openclaw cascades through llm-gateway (no direct provider requirement)", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const caps = catalog.services["openclaw"]?.capabilities;
      expect(caps?.requires_all_of, "openclaw must declare all-of for llm-gateway cascade").toEqual([
        { local_service: "llm-gateway" },
      ]);
    });

    it("local-only extras (vllm, ollama) are declared so capability targets resolve", () => {
      const catalog: Catalog = readJSON(SERVICES);
      expect(catalog.extras?.vllm, "vllm must be declared in extras").toBeTruthy();
      expect(catalog.extras?.ollama, "ollama must be declared in extras").toBeTruthy();
    });

    it("design doc exists and references the evaluator script", () => {
      const doc = read(CAPABILITY_GATES_DOC);
      expect(doc).toMatch(/scripts\/lib\/eval-capabilities\.mjs/);
      expect(doc).toMatch(/requires_any_of/);
      expect(doc).toMatch(/requires_all_of/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Evaluator behaviour
  // ────────────────────────────────────────────────────────────────────────
  describe("Evaluator semantics", () => {
    it("service with no capabilities block is unconditionally enabled", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup: emptyEnvMap(),
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv(),
      });
      expect(report.services.core.enabled).toBe(true);
      expect(report.services.core.reason).toMatch(/no capabilities required/);
    });

    it("requires_any_of: at least one external_key satisfies", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const envProdBackup = new Map<string, string>([
        ["ANTHROPIC_API_KEY", "sk-ant-xxx"],
      ]);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup,
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv(),
      });
      expect(report.services["llm-gateway"].enabled).toBe(true);
      expect(report.services["llm-gateway"].reason).toMatch(/ANTHROPIC_API_KEY/);
    });

    it("requires_any_of: no external_key and no local_service ⇒ disabled", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup: emptyEnvMap(),
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv(),
      });
      expect(report.services["llm-gateway"].enabled).toBe(false);
      expect(report.services["llm-gateway"].reason).toMatch(/requires_any_of unmet/);
    });

    it("local_service: vllm via LOCAL_SERVICE_VLLM=1 satisfies the gate", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup: emptyEnvMap(),
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv({ LOCAL_SERVICE_VLLM: "1" }),
      });
      expect(report.services["llm-gateway"].enabled).toBe(true);
      expect(report.services["llm-gateway"].reason).toMatch(/vllm/);
    });

    it("cascade: openclaw is disabled when llm-gateway is disabled", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup: emptyEnvMap(),
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv(),
      });
      expect(report.services["openclaw"].enabled).toBe(false);
      expect(report.services["openclaw"].reason).toMatch(/llm-gateway disabled/);
    });

    it("cascade: openclaw is enabled when llm-gateway is satisfied", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const envProdBackup = new Map<string, string>([
        ["OPENAI_API_KEY", "sk-xxx"],
      ]);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup,
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv(),
      });
      expect(report.services["openclaw"].enabled).toBe(true);
    });

    it("env layering: process.env > .env.coolify > .env-prod-backup (first non-empty wins)", () => {
      // .env-prod-backup says the key is unset, .env.coolify has it set →
      // the coolify-generated value should satisfy the gate. (This shape
      // matters because cold-start regenerates .env.coolify but trusts
      // .env-prod-backup as the long-term store; either source counts.)
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = readJSON(PROFILE_CLOUD_MULTI);
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup: new Map<string, string>([["ANTHROPIC_API_KEY", ""]]),
        envCoolify: new Map<string, string>([["ANTHROPIC_API_KEY", "sk-from-coolify"]]),
        processEnv: makeProcessEnv(),
      });
      expect(report.services["llm-gateway"].enabled).toBe(true);
    });

    it("excluded services report a deterministic excluded reason", () => {
      const catalog: Catalog = readJSON(SERVICES);
      const profile: Profile = {
        ...readJSON(PROFILE_CLOUD_MULTI),
        exclude: ["openclaw", "llm-gateway"],
      };
      const report = evaluateCapabilities({
        catalog,
        profile,
        envProdBackup: emptyEnvMap(),
        envCoolify: emptyEnvMap(),
        processEnv: makeProcessEnv(),
      });
      expect(report.services["openclaw"].enabled).toBe(false);
      expect(report.services["openclaw"].reason).toMatch(/excluded by profile/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Cycle detection (safety)
  // ────────────────────────────────────────────────────────────────────────
  describe("Cycle detection", () => {
    it("a direct cycle (A.local_service→B, B.local_service→A) throws", () => {
      const catalog: Catalog = {
        services: {
          a: {
            tier: "optional",
            capabilities: { requires_all_of: [{ local_service: "b" }] },
          },
          b: {
            tier: "optional",
            capabilities: { requires_all_of: [{ local_service: "a" }] },
          },
        },
      };
      const profile: Profile = {
        id: "cycle-test",
        tier_filter: ["optional"],
      };
      expect(() =>
        evaluateCapabilities({
          catalog,
          profile,
          envProdBackup: emptyEnvMap(),
          envCoolify: emptyEnvMap(),
          processEnv: makeProcessEnv(),
        }),
      ).toThrow(/cycle/i);
    });
  });
});
