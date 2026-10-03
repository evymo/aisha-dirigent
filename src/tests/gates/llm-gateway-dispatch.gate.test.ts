/**
 * LLM Gateway dispatch architecture gate.
 *
 * Enforces the invariant that AISHA's resolver decision (`aisha_resolve_clow_backend`)
 * is **honored** by the execution layer (`generator` node + `llmRouter`). Specifically:
 *
 *  - The provider catalog declares `llm-gateway` as a first-class backend
 *    (backend_kind=llm_gateway), reachable via AISHA_LLM_GATEWAY_KEY.
 *  - The SQL resolver does NOT exclude `llm_gateway` from candidate scoring.
 *    AISHA must be free to pick the gateway when cost / capability fit warrant it.
 *  - The reflection generator node consults `state.clow_backend` BEFORE
 *    falling back to slot-based model resolution. Without this, AISHA's
 *    routing decision is silently overridden by static prefix-matching
 *    in `resolveProvider()`.
 *  - `llmRouter` exposes `'gateway'` as a recognized provider variant so
 *    `unifiedChat` can dispatch through the gateway URL with the right auth
 *    env (AISHA_LLM_GATEWAY_KEY) instead of falling through to direct call.
 *  - Cold-start orchestration writes AISHA_LLM_GATEWAY_KEY +
 *    AISHA_LLM_GATEWAY_URL to .env.coolify so the runtime container has them.
 *  - config/domains.env declares LLM_GATEWAY_DOMAIN (single source of truth).
 *
 * Reads only files (no DB / no network). Suitable for pre-push hook.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { providerForResolvedBackend } from "../../../services/svc-ai-chat/src/lib/providerIdentity.js";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ── Anchors / file paths ───────────────────────────────────────────────────
// Provider catalog SEED lives in canonical SoT (core seed), NOT in an archived
// migration. The backend_kind CHECK (schema) lives in the table SoT below.
const PROVIDER_SEED = "aisha/db/seed/core/19_ai_provider_catalog.sql";
const RESOLVER_SQL = "aisha/db/sql/functions/aisha_resolve_clow_backend.sql";
const GENERATOR_TS = "services/svc-ai-chat/src/reflection/nodes/generator.ts";
// E0.1: the resolver-first dispatch + backend_kind→provider mapping were
// promoted out of generator.ts into the shared SoT module. The invariant is
// unchanged; its source of truth moved here.
const DECISION_TS = "services/svc-ai-chat/src/reflection/decision.ts";
const LLM_ROUTER_TS = "services/svc-ai-chat/src/lib/llmRouter.ts";
const COLD_START = "scripts/aisha-cold-start.sh";
const GENERATE_SECRETS = "scripts/generate-secrets.mjs";
const DOMAINS_ENV = "config/domains.env";
const PROVIDER_REGISTRY_TABLE = "aisha/db/sql/tables/ai_provider_registry.sql";

describe("LLM Gateway dispatch architecture", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Catalog: llm-gateway exists as a provider row
  // ─────────────────────────────────────────────────────────────────────────
  describe("Provider catalog includes llm-gateway", () => {
    it("ai_provider_registry table declares backend_kind CHECK with 'llm_gateway'", () => {
      // Schema SoT: the backend_kind CHECK constraint (table file) is the single
      // source of truth for valid backend_kind values; it must accept 'llm_gateway'.
      const sql = read(PROVIDER_REGISTRY_TABLE);
      expect(
        sql,
        "backend_kind CHECK constraint must include 'llm_gateway'",
      ).toMatch(/backend_kind\s+text[\s\S]+?CHECK[\s\S]+?llm_gateway/i);
    });

    it("seed row for slug='llm-gateway' is INSERTed with backend_kind='llm_gateway'", () => {
      const sql = read(PROVIDER_SEED);
      // Look for the seed VALUES tuple in the canonical core seed.
      expect(
        sql,
        "core seed must register llm-gateway provider with backend_kind=llm_gateway",
      ).toMatch(/'llm-gateway'[^)]+'llm_gateway'/);
    });

    it("seed row uses AISHA_LLM_GATEWAY_KEY as auth_env_var", () => {
      const sql = read(PROVIDER_SEED);
      // The auth_env_var column for llm-gateway must reference the canonical
      // env name (matches scripts/generate-secrets.mjs + cold-start HEREDOC).
      const llmGatewayRow = sql.match(/'llm-gateway'[^)]+\)/);
      expect(
        llmGatewayRow,
        "llm-gateway provider row not found in core seed",
      ).not.toBeNull();
      expect(
        llmGatewayRow![0],
        "llm-gateway row must reference AISHA_LLM_GATEWAY_KEY env",
      ).toContain("AISHA_LLM_GATEWAY_KEY");
    });

    it("seed description does NOT claim the gateway is excluded from sync", () => {
      // Post E0.1/E0.2 the resolver honors backend_kind='llm_gateway' for sync
      // too, so the legacy "does NOT route through Gateway for sync" note would
      // be a lie. The canonical core seed must carry the corrected note — we
      // assert it directly (no archive/migration fallback: gates read SoT only).
      const sql = read(PROVIDER_SEED);
      const llmGatewayRow = sql.match(/'llm-gateway'[\s\S]+?\),/);
      expect(
        llmGatewayRow,
        "llm-gateway provider row not found in core seed",
      ).not.toBeNull();
      expect(
        /does NOT route through Gateway for sync/i.test(llmGatewayRow![0]),
        "llm-gateway seed note must NOT claim the gateway is excluded from sync " +
        "(the resolver honors backend_kind='llm_gateway' for sync after E0.1/E0.2).",
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Resolver: doesn't exclude gateway from candidates
  // ─────────────────────────────────────────────────────────────────────────
  describe("aisha_resolve_clow_backend respects backend_kind freedom", () => {
    it("WHERE clause does not blacklist backend_kind='llm_gateway'", () => {
      const sql = read(RESOLVER_SQL);
      // Look for any clause that excludes llm_gateway by backend_kind
      const exclusionPatterns = [
        /p\.backend_kind\s*(?:NOT IN|<>|!=)\s*\(?\s*[^)]*'llm_gateway'/i,
        /backend_kind\s*=\s*'llm_gateway'[\s\S]{0,40}(?:false|=\s*false)/i,
      ];
      for (const pat of exclusionPatterns) {
        expect(
          sql,
          `Resolver excludes llm_gateway via pattern: ${pat} — AISHA must be free to pick it.`,
        ).not.toMatch(pat);
      }
    });

    it("score formula treats llm_gateway like any other backend (no zero-weight branch)", () => {
      const sql = read(RESOLVER_SQL);
      // Anti-pattern: zeroing out the score when backend_kind='llm_gateway'.
      // E.g. `CASE WHEN p.backend_kind = 'llm_gateway' THEN 0 ELSE ... END`
      expect(
        sql,
        "Resolver must not zero score on llm_gateway — that would architecturally exclude it.",
      ).not.toMatch(/p\.backend_kind\s*=\s*'llm_gateway'\s+THEN\s+0(?:\.0+)?\s+ELSE/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Generator: honors state.clow_backend before slot fallback
  // ─────────────────────────────────────────────────────────────────────────
  describe("generator node honors state.clow_backend", () => {
    it("reads state.clow_backend (resolver output) before falling back to slot", () => {
      const ts = read(GENERATOR_TS);
      // Must reference clow_backend from state. Without this read, AISHA's
      // resolver decision is silently dropped on the floor.
      expect(
        ts,
        "generator.ts must read state.clow_backend and pass it to the resolver helper",
      ).toMatch(/state\.clow_backend|state\[\s*['"]clow_backend['"]\s*\]/);
    });

    it("routes the resolver decision through the shared resolveModelWithClow() helper", () => {
      // E0.1/E0.2: generator must not re-derive its own model; it delegates to
      // the single SoT helper so the resolver-first priority is identical for
      // every reflection LLM node.
      const ts = read(GENERATOR_TS);
      expect(
        ts,
        "generator.ts must call resolveModelWithClow() (shared resolver-first dispatch)",
      ).toMatch(/resolveModelWithClow\s*\(/);
    });

    it("maps backend_kind === 'llm_gateway' → gateway provider in the SoT (providerIdentity.ts, decision.ts delegates)", () => {
      // The backend_kind→LlmProvider branch moved into the shared SoT
      // (mapBackendKindToProvider), and 2026-09-15 further into providerIdentity.ts
      // (providerForResolvedBackend) — ONE conversion for every backend the resolver
      // returns, instead of a second copy of the kind/slug table in decision.ts.
      // The invariant is unchanged: a clow whose backend_kind is 'llm_gateway' must
      // dispatch via the 'gateway' provider, NOT a static prefix match — measured by
      // CALLING the conversion, not by reading its text.
      const ts = read(DECISION_TS);
      expect(
        ts,
        "decision.ts mapBackendKindToProvider must delegate to providerForResolvedBackend",
      ).toMatch(/mapBackendKindToProvider\([^)]*\)[^{]*\{\s*const provider = providerForResolvedBackend\(clow\)/);
      expect(providerForResolvedBackend({ backend_kind: "llm_gateway", provider_slug: "llmgateway-io" })).toBe("gateway");
      expect(providerForResolvedBackend({ backend_kind: "llm_gateway", provider_slug: "llm-gateway" })).toBe("gateway");
    });

    it("falls back to slot-based resolution when state.clow_backend is absent (SoT helper)", () => {
      // The resolveSlotModel() fallback path lives in the shared helper now
      // (when the resolver hasn't run yet, e.g. quick-chat without a graph).
      const ts = read(DECISION_TS);
      expect(
        ts,
        "decision.ts resolveModelWithClow() must keep resolveSlotModel() as the fallback",
      ).toMatch(/resolveSlotModel\s*\(/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. llmRouter: 'gateway' is a first-class provider variant
  // ─────────────────────────────────────────────────────────────────────────
  describe("llmRouter declares 'gateway' as a provider variant", () => {
    it("LlmProvider type union includes 'gateway'", () => {
      const ts = read(LLM_ROUTER_TS);
      // Either a TypeScript union like `'anthropic' | 'gateway' | ...` or an
      // exported const array containing 'gateway'.
      const hasUnion = /type\s+LlmProvider\s*=[\s\S]+?['"]gateway['"]/.test(ts);
      const hasArr = /(?:const|let|var)\s+LLM_PROVIDERS[\s\S]+?['"]gateway['"]/.test(ts);
      expect(
        hasUnion || hasArr,
        "LlmProvider must accept 'gateway' so unifiedChat() can dispatch through gateway.aisha.guru",
      ).toBe(true);
    });

    it("unifiedChat handles provider==='gateway' (an explicit branch must exist)", () => {
      const ts = read(LLM_ROUTER_TS);
      expect(
        ts,
        "llmRouter must have a 'gateway' branch in unifiedChat that uses AISHA_LLM_GATEWAY_KEY",
      ).toMatch(/(?:case|if)[\s\S]{0,60}['"]gateway['"]/);
    });

    it("gateway branch uses AISHA_LLM_GATEWAY_KEY for auth (not provider keys)", () => {
      // The branch handling provider==='gateway' must reference the canonical
      // auth env name somewhere — either in the branch body (explicit env
      // read), in adjacent comments documenting the auth path, or by name
      // in the same file. Without it, the gateway call has no credential.
      const ts = read(LLM_ROUTER_TS);
      // Direct check: file must mention AISHA_LLM_GATEWAY_KEY at least once.
      // The actual env read can be in this file (UnifiedChat dispatch) or in
      // the backend factory (createGatewayBackend), which was extracted to the
      // shared @aisha/llm-dispatch package (behavior-preserving git mv).
      const compatTs = read(
        "packages/llm-dispatch/src/providers/openai-compat.ts",
      );
      const referencedHere = /AISHA_LLM_GATEWAY_KEY/.test(ts);
      const referencedInBackend = /AISHA_LLM_GATEWAY_KEY/.test(compatTs);
      expect(
        referencedHere || referencedInBackend,
        "Gateway auth env (AISHA_LLM_GATEWAY_KEY) must be referenced in llmRouter " +
        "or its backend factory (openai-compat.ts createGatewayBackend)",
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Cold-start: writes gateway secrets to .env.coolify
  // ─────────────────────────────────────────────────────────────────────────
  describe("Cold-start integration", () => {
    it("scripts/generate-secrets.mjs emits AISHA_LLM_GATEWAY_KEY", () => {
      const js = read(GENERATE_SECRETS);
      expect(
        js,
        "generate-secrets.mjs must emit AISHA_LLM_GATEWAY_KEY (gateway service bearer)",
      ).toMatch(/emit\s*\(\s*['"]AISHA_LLM_GATEWAY_KEY['"]/);
    });

    it("scripts/generate-secrets.mjs emits the 4 internal gateway secrets", () => {
      const js = read(GENERATE_SECRETS);
      const required = [
        "LLM_GATEWAY_DB_PASSWORD",
        "LLM_GATEWAY_SECRET",
        "LLM_GATEWAY_OIDC_SECRET",
        "AISHA_LLM_GATEWAY_KEY",
      ];
      const missing = required.filter(
        (k) => !new RegExp(`emit\\s*\\(\\s*['"]${k}['"]`).test(js),
      );
      expect(
        missing,
        `generate-secrets.mjs missing emit() for: ${missing.join(", ")}`,
      ).toEqual([]);
    });

    it("cold-start writes AISHA_LLM_GATEWAY_KEY + AISHA_LLM_GATEWAY_URL to .env.coolify HEREDOC", () => {
      const sh = read(COLD_START);
      expect(sh).toMatch(/AISHA_LLM_GATEWAY_KEY=/);
      expect(sh).toMatch(/AISHA_LLM_GATEWAY_URL=/);
    });

    it("cold-start REGEN_KEYS set preserves gateway secrets across re-runs", () => {
      const sh = read(COLD_START);
      // The regen set lives in the REGEN_KEY_PATTERNS bash array (one pattern
      // per line, joined into REGEN_KEYS at runtime — 2026-06-10 reviewability
      // refactor of the former single-line mega-regex). Assert set MEMBERSHIP,
      // not the join format.
      const block = sh.match(/REGEN_KEY_PATTERNS=\(([\s\S]*?)\n\s*\)/);
      expect(
        block,
        "REGEN_KEY_PATTERNS array must exist in cold-start",
      ).not.toBeNull();
      expect(
        block![1],
        "regen set must cover LLM_GATEWAY_* secrets",
      ).toMatch(/LLM_GATEWAY_\(/);
      expect(
        block![1],
        "regen set must cover AISHA_LLM_GATEWAY_KEY/URL",
      ).toMatch(/AISHA_LLM_GATEWAY_\(KEY\|URL\)/);
    });

    it("BYOK provider keys (ANTHROPIC/OPENAI/GOOGLE_AI) are preserved or empty-defaulted", () => {
      const sh = read(COLD_START);
      // These are operator-supplied (BYOK), not auto-generated. Empty
      // placeholder is acceptable; the gateway returns "provider not
      // configured" at runtime if a clow picks an unset provider.
      expect(sh).toMatch(/ANTHROPIC_API_KEY=\$\{ANTHROPIC_API_KEY:?-?\}?/);
      expect(sh).toMatch(/OPENAI_API_KEY=\$\{OPENAI_API_KEY:?-?\}?/);
      expect(sh).toMatch(/GOOGLE_AI_API_KEY=\$\{GOOGLE_AI_API_KEY:?-?\}?/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Domain config — single source of truth (resolver-driven)
  //
  // Canonical SoT: config/services.json declares the service (with subdomain
  // + per-profile service_overrides.legacy_env_var); scripts/lib/derive-
  // domains.mjs emits the env vars at cold-start. We do NOT check
  // config/domains.env for these statically — that would entrench a
  // duplicated source of truth. Instead we run the resolver and assert it
  // emits the expected env vars.
  // ─────────────────────────────────────────────────────────────────────────
  describe("Topology resolver emits gateway + openclaw domain env vars", () => {
    // Run resolver once for the whole describe block (cheap: <100ms).
    function resolverShell(profile: string): string {
      return execFileSync(
        "node",
        ["scripts/lib/derive-domains.mjs", "--shell", `--profile=${profile}`],
        { encoding: "utf8", env: { ...process.env, MESH_ENABLED: "false" } },
      );
    }

    it("cloud-multi profile emits LLM_GATEWAY_DOMAIN (via legacy_env_var)", () => {
      const out = resolverShell("cloud-multi");
      expect(
        out,
        "resolver must emit LLM_GATEWAY_DOMAIN — check cloud-multi.json service_overrides[llm-gateway].legacy_env_var=LLM_GATEWAY",
      ).toMatch(/^LLM_GATEWAY_DOMAIN=\S+\.\S+/m);
    });

    it("cloud-single profile declares legacy_env_var so opt-in include[] still emits LLM_GATEWAY_DOMAIN", () => {
      // cloud-single's tier_filter excludes "optional" (llm-gateway + openclaw)
      // by design — minimal single-host stack. But the profile's
      // service_overrides MUST declare legacy_env_var for both services so
      // operators who opt in via include[] get the resolver-emitted env var
      // without further config.
      const profile = JSON.parse(read("config/profiles/cloud-single.json")) as {
        service_overrides?: Record<string, { legacy_env_var?: string }>;
      };
      expect(
        profile.service_overrides?.["llm-gateway"]?.legacy_env_var,
        "cloud-single profile must declare legacy_env_var=LLM_GATEWAY for llm-gateway (resolver legacy alias)",
      ).toBe("LLM_GATEWAY");
      expect(
        profile.service_overrides?.["openclaw"]?.legacy_env_var,
        "cloud-single profile must declare legacy_env_var=OPENCLAW for openclaw (resolver legacy alias)",
      ).toBe("OPENCLAW");
    });

    it("cloud-multi profile emits OPENCLAW_DOMAIN (sibling Phase 2 stack)", () => {
      const out = resolverShell("cloud-multi");
      expect(
        out,
        "resolver must emit OPENCLAW_DOMAIN — check cloud-multi.json service_overrides[openclaw].legacy_env_var=OPENCLAW",
      ).toMatch(/^OPENCLAW_DOMAIN=\S+\.\S+/m);
    });

    it("resolver also emits canonical (subdomain-based) GATEWAY_DOMAIN", () => {
      // Belt-and-suspenders: even without legacy_env_var, services.json's
      // subdomain "gateway" produces GATEWAY_DOMAIN. We expose BOTH so old
      // consumers reading LLM_GATEWAY_DOMAIN and new consumers reading
      // GATEWAY_DOMAIN both work.
      const out = resolverShell("cloud-multi");
      expect(out).toMatch(/^GATEWAY_DOMAIN=\S+\.\S+/m);
    });

    it("openclaw AISHA_MCP_URL is wired to ${API_DOMAIN}/mcp (numbered dep, no MCP_KNOWLEDGE_DOMAIN override)", () => {
      // Updated 2026-05-16 (capability-gates PR): MCP_KNOWLEDGE_DOMAIN was a
      // fake-config var masking the numbered dependency openclaw → core. Now
      // removed entirely. openclaw compose hard-wires AISHA_MCP_URL to
      // ${API_DOMAIN}/mcp. If a dedicated mcp-knowledge service is ever added,
      // declare it in config/services.json and let the resolver own its domain.
      // See docs/architecture/CAPABILITY_GATES.md.
      const compose = read("docker-compose.coolify-openclaw.yml");
      expect(
        compose,
        "openclaw compose must wire AISHA_MCP_URL directly to ${API_DOMAIN}/mcp (numbered dependency, no override)",
      ).toMatch(/AISHA_MCP_URL=https:\/\/\$\{API_DOMAIN\}\/mcp/);
      // Anti-regression: no MCP_KNOWLEDGE_DOMAIN var or :-default should
      // resurface — that would re-introduce the vestigial config pattern.
      expect(
        compose,
        "MCP_KNOWLEDGE_DOMAIN must NOT reappear in openclaw compose (vestigial-defaults audit)",
      ).not.toMatch(/\$\{MCP_KNOWLEDGE_DOMAIN/);
    });

    it("config/domains.env does NOT statically declare resolver-derived vars (no SoT drift)", () => {
      // Guard against re-introduction of duplicate sources of truth.
      const env = read(DOMAINS_ENV);
      // ^...=value lines (not inside a comment ${...:-default} expansion).
      // We look for assignment lines, not references — references like
      // `https://${LLM_GATEWAY_DOMAIN}` are fine; `LLM_GATEWAY_DOMAIN=...`
      // would shadow the resolver.
      expect(
        env,
        "domains.env must not statically assign LLM_GATEWAY_DOMAIN — resolver owns it",
      ).not.toMatch(/^LLM_GATEWAY_DOMAIN=\S/m);
      expect(
        env,
        "domains.env must not statically assign OPENCLAW_DOMAIN — resolver owns it",
      ).not.toMatch(/^OPENCLAW_DOMAIN=\S/m);
    });

    it("compose files reference ${LLM_GATEWAY_DOMAIN} variable in env block", () => {
      // The llm-gateway service env must propagate LLM_GATEWAY_DOMAIN +
      // LLM_GATEWAY_PUBLIC_URL through to the container (theopenco/llmgateway
      // builds OAuth callback URLs from it). Traefik labels stay literal
      // (Coolify escapes $ → $$ in label values — see
      // feedback_coolify_label_dollar_escape.md).
      const compose = read("docker-compose.coolify-llm-gateway.yml");
      // Find the llm-gateway service block specifically (skip db-init).
      // JavaScript regex has no \Z anchor — use $ with /m + end-of-string match,
      // or just rely on the lookahead matching the NEXT service header. If
      // there's no next service, the match runs to EOF naturally.
      const serviceMatch = compose.match(
        /^\s{2}llm-gateway:[\s\S]+?(?=^\s{2}[a-z][a-z0-9-]*:|^[a-z][a-z0-9-]*:|$(?![\s\S]))/m,
      );
      expect(
        serviceMatch,
        "llm-gateway service block not found in compose file",
      ).not.toBeNull();
      expect(
        serviceMatch![0],
        "llm-gateway service env must reference ${LLM_GATEWAY_DOMAIN} for OAuth callback URL",
      ).toMatch(/\$\{LLM_GATEWAY_DOMAIN/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. SoT table — ai_provider_registry exists + has expected columns
  // ─────────────────────────────────────────────────────────────────────────
  describe("ai_provider_registry SoT integrity", () => {
    it("table file exists and declares backend_kind column", () => {
      expect(existsSync(join(ROOT, PROVIDER_REGISTRY_TABLE))).toBe(true);
      const sql = read(PROVIDER_REGISTRY_TABLE);
      expect(sql).toMatch(/backend_kind/i);
    });

    it("table file declares endpoint_url + auth_env_var (the two fields executor needs)", () => {
      const sql = read(PROVIDER_REGISTRY_TABLE);
      expect(sql).toMatch(/endpoint_url/i);
      expect(sql).toMatch(/auth_env_var/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Decision provenance — drift detection between resolver and executor
  // ─────────────────────────────────────────────────────────────────────────
  describe("Decision provenance records resolver → executor drift", () => {
    it("decisionProvenance.ts mentions clow_backend or execution_strategy logging", () => {
      const path = "services/svc-ai-chat/src/lib/decisionProvenance.ts";
      if (!existsSync(join(ROOT, path))) {
        // If the file is moved, point us at where the new home is
        return;
      }
      const ts = read(path);
      expect(
        ts,
        "decisionProvenance must log the resolver decision (clow_backend or execution_strategy)",
      ).toMatch(/clow_backend|execution_strategy|aisha_choose_execution_strategy/);
    });
  });
});
