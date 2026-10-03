/**
 * Provider Catalog Completeness Gate Tests
 *
 * Locks in the contract: ai_provider_registry MUST seed all providers AISHA
 * can dispatch to at decision time. Missing provider rows = resolver
 * (aisha_resolve_clow_backend) silently never considers them.
 *
 * Categories:
 *   1. Required providers exist in seed migrations:
 *        anthropic, openai, google-genai, llm-gateway, llmgateway-io,
 *        xai, mistral, deepseek
 *   2. llmgateway.io has backend_kind='llm_gateway' + LLM_GW_API_KEY env var
 *   3. Direct-provider disabled placeholders carry [opt-in: ...] marker
 *   4. The gateway compose file passes LLM_GW_API_KEY to the daemon so
 *      theopenco/llmgateway can use llmgateway.io as upstream meta-provider.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

const REQUIRED_PROVIDER_SLUGS = [
  "anthropic",
  "openai",
  "google-genai",
  "llm-gateway",
  "llmgateway-io",
  "xai",
  "mistral",
  "deepseek",
] as const;

// Canonical SoT: the provider catalog lives in a core SEED file, NOT in
// archived migrations. Gates must read only current SoT (never archive/).
const PROVIDER_SEED_FILE = "aisha/db/seed/core/19_ai_provider_catalog.sql";
const PROVIDER_SEED_FILES = [PROVIDER_SEED_FILE];

const GATEWAY_COMPOSE = "docker-compose.coolify-llm-gateway.yml";

function readFile(rel: string): string {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

function collectSeedContent(): string {
  return PROVIDER_SEED_FILES.map((f) => readFile(f)).join("\n");
}

describe("Provider Catalog Completeness", () => {
  it("all required provider slugs are seeded in ai_provider_registry", () => {
    const seedContent = collectSeedContent();
    const missing: string[] = [];

    for (const slug of REQUIRED_PROVIDER_SLUGS) {
      // Match seed INSERT pattern: ('slug', 'display_name', ...)
      const re = new RegExp(`\\(\\s*'${slug}'\\s*,`, "m");
      if (!re.test(seedContent)) missing.push(slug);
    }

    expect(
      missing,
      `Missing provider seeds (add to ai_provider_registry):\n  ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("llmgateway-io is seeded with backend_kind='llm_gateway' and LLM_GW_API_KEY env var", () => {
    const seedContent = collectSeedContent();

    // Find the llmgateway-io seed row by locating the slug and then grabbing
    // the next 12 lines (a seed row spans 2-5 physical lines in our SQL files).
    // We can't use a simple regex with `\)` because the display_name string
    // contains '(managed)' which would match prematurely.
    const lines = seedContent.split("\n");
    const startIdx = lines.findIndex((l) => /\(\s*'llmgateway-io'\s*,/.test(l));
    expect(
      startIdx,
      "llmgateway-io seed row not found — check provider_catalog_extensions migration",
    ).toBeGreaterThan(-1);

    const row = lines.slice(startIdx, startIdx + 12).join("\n");
    expect(
      row,
      "llmgateway-io must have backend_kind='llm_gateway' (route through gateway dispatch path)",
    ).toMatch(/'llm_gateway'/);
    expect(
      row,
      "llmgateway-io must reference LLM_GW_API_KEY env var (single pooled key for xAI/Mistral/DeepSeek/Cohere/Together)",
    ).toMatch(/'LLM_GW_API_KEY'/);
    expect(row, "llmgateway-io endpoint should be api.llmgateway.io/v1").toMatch(
      /api\.llmgateway\.io/,
    );
  });

  it("direct-provider placeholders (xai/mistral/deepseek) are disabled by default", () => {
    const ext = readFile(PROVIDER_SEED_FILE);
    expect(ext.length, "provider catalog seed must exist").toBeGreaterThan(100);

    // Must contain explicit UPDATE that disables these slugs after insert
    expect(
      ext,
      "provider catalog seed must explicitly UPDATE is_enabled=false for xai/mistral/deepseek",
    ).toMatch(/UPDATE\s+public\.ai_provider_registry[\s\S]+SET\s+is_enabled\s*=\s*false[\s\S]+WHERE\s+slug\s+IN\s*\(\s*'xai'/);
  });

  it("ON CONFLICT clause does NOT update is_enabled (operator choice preserved)", () => {
    const ext = readFile(PROVIDER_SEED_FILE);

    // Strip SQL line comments (`-- ...`) first so a comment that mentions
    // is_enabled doesn't trigger a false positive on a clean SET clause.
    const noComments = ext
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");

    const onConflictMatch = noComments.match(/ON\s+CONFLICT\s*\(\s*slug\s*\)\s*DO\s+UPDATE[\s\S]+?;/);
    expect(onConflictMatch, "extensions migration must use ON CONFLICT DO UPDATE").not.toBeNull();
    expect(
      onConflictMatch![0],
      "ON CONFLICT SET clause must NOT include is_enabled — otherwise re-running the migration overrides operator's opt-in/opt-out choice",
    ).not.toMatch(/is_enabled\s*=/);
  });

  it("gateway compose passes LLM_GW_API_KEY to the daemon (upstream pooled key)", () => {
    const compose = readFile(GATEWAY_COMPOSE);
    expect(compose.length, "gateway compose must exist").toBeGreaterThan(100);
    expect(
      compose,
      "gateway compose must wire LLM_GW_API_KEY env so theopenco/llmgateway can use llmgateway.io as upstream meta-provider",
    ).toMatch(/-\s+LLM_GW_API_KEY\s*=\s*\$\{LLM_GW_API_KEY/);
  });

  it("AISHA_LLM_GATEWAY_KEY (inbound auth) and LLM_GW_API_KEY (outbound upstream) are distinct", () => {
    const compose = readFile(GATEWAY_COMPOSE);
    // Both env wires must be present
    expect(compose).toMatch(/LLM_GATEWAY_API_KEY\s*=\s*\$\{AISHA_LLM_GATEWAY_KEY/);
    expect(compose).toMatch(/LLM_GW_API_KEY\s*=\s*\$\{LLM_GW_API_KEY/);
    // They must NOT be aliased — different keys serve different roles:
    // AISHA_LLM_GATEWAY_KEY = service-to-service bearer that AISHA backend
    //   (or IDE proxy) presents WHEN CALLING our self-hosted gateway.
    // LLM_GW_API_KEY = OUR account key at llmgateway.io that the gateway
    //   uses WHEN CALLING UPSTREAM to llmgateway.io managed service.
    expect(
      compose,
      "the two keys must remain distinct env vars — never alias LLM_GW_API_KEY=${AISHA_LLM_GATEWAY_KEY}",
    ).not.toMatch(/LLM_GW_API_KEY\s*=\s*\$\{AISHA_LLM_GATEWAY_KEY/);
  });

  it("audit_journal records the catalog seed event", () => {
    const ext = readFile(PROVIDER_SEED_FILE);
    expect(ext, "provider catalog seed must insert an audit_journal row").toMatch(
      /INSERT\s+INTO\s+public\.audit_journal[\s\S]+'provider_catalog_seeded'/,
    );
  });
});
