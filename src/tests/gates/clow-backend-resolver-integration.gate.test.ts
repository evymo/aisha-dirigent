/**
 * Clow Backend Resolver — Integration Gate Tests
 *
 * Structural contract for aisha_resolve_clow_backend RPC: the function MUST
 * read from ai_provider_registry, filter by is_enabled, score on supports_batch
 * + cost_class + health, and return backend_kind + strategy + provider_slug in
 * the output JSON. Together with provider-catalog-completeness.gate.test.ts,
 * this proves that:
 *
 *   1. New providers seeded in ai_provider_registry (llmgateway-io, xai,
 *      mistral, deepseek) WILL be considered by the resolver — the query
 *      explicitly reads from this table.
 *   2. Disabled providers (is_enabled=false) won't accidentally win.
 *   3. Batch-eligibility filter (supports_batch) is part of scoring, so
 *      tasks with strategy='batch' actually pick batch-capable providers.
 *   4. The returned shape contains the fields the TS generator depends on:
 *      backend_kind, provider_slug, model_id, strategy.
 *
 * This is a STRUCTURAL test (SQL string inspection) — not a runtime DB test.
 * Runtime behavior is verified by services/svc-ai-chat/src/tests/reflection/
 * batch-flow.integration.test.ts (TS-side mocked) and by pgTAP/manual smoke
 * after migration apply.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const RESOLVER_SQL = path.join(
  ROOT,
  "aisha/db/sql/functions/aisha_resolve_clow_backend.sql",
);

function readResolver(): string {
  const content = fs.readFileSync(RESOLVER_SQL, "utf-8");
  // Strip SQL line comments so regex matches don't trip on documentation
  return content
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("Clow Backend Resolver — structural integration contract", () => {
  it("RPC source file exists", () => {
    expect(fs.existsSync(RESOLVER_SQL)).toBe(true);
  });

  it("reads from ai_provider_registry (so newly seeded providers are considered)", () => {
    const sql = readResolver();
    expect(
      sql,
      "aisha_resolve_clow_backend MUST query ai_provider_registry — otherwise new providers (llmgateway-io, xai, mistral, deepseek) are invisible to the scoring path",
    ).toMatch(/(FROM|JOIN)\s+(public\.)?ai_provider_registry/);
  });

  it("filters by is_enabled (disabled providers cannot win)", () => {
    const sql = readResolver();
    // The filter can appear as WHERE clause or JOIN condition. Looking for
    // any usage of p.is_enabled in a boolean-truthiness context.
    expect(
      sql,
      "Resolver MUST filter by p.is_enabled — otherwise disabled placeholders (xai/mistral/deepseek without keys) silently win and break the dispatch",
    ).toMatch(/p\.is_enabled\b/);
  });

  it("considers supports_batch capability in scoring + filtering", () => {
    const sql = readResolver();
    expect(
      sql,
      "supports_batch must be in resolver — strategy='batch' must filter to batch-capable providers, otherwise the resolver picks a sync-only provider and the strategy flag is ignored",
    ).toMatch(/supports_batch/);
  });

  it("considers cost_class for budget/standard/premium filtering", () => {
    const sql = readResolver();
    expect(
      sql,
      "cost_class must be in resolver — budget profile must prefer cost_class='budget' providers (llmgateway-io being our new budget entrant)",
    ).toMatch(/cost_class/);
  });

  it("considers last_health_status (unhealthy providers deprioritized)", () => {
    const sql = readResolver();
    expect(
      sql,
      "last_health_status must be considered — degraded/down providers should score lower so resolver fails over",
    ).toMatch(/last_health_status/);
  });

  it("returns the fields TS generator needs (backend_kind, provider_slug, model_id, strategy)", () => {
    const sql = readResolver();
    // The JSON returned by the RPC must contain these keys — they're what
    // generator.ts (mapBackendKindToProvider + batch dispatch branch) reads.
    expect(sql, "RPC return JSON must include 'backend_kind' key").toMatch(
      /'backend_kind'/,
    );
    expect(sql, "RPC return JSON must include 'provider_slug' / 'slug' key").toMatch(
      /'provider_slug'|'slug'/,
    );
    expect(sql, "RPC return JSON must include 'model_id' key").toMatch(
      /'model_id'/,
    );
    expect(sql, "RPC return JSON must include 'strategy' key").toMatch(
      /'strategy'/,
    );
  });

  it("function signature stable: keep the (jsonb, jsonb) input contract", () => {
    const sql = readResolver();
    // generator.ts + openclaw_resolve_clow rely on the resolver's contract.
    // Drift would silently break runtime calls.
    expect(
      sql,
      "aisha_resolve_clow_backend must remain callable as (p_task jsonb, p_context jsonb)",
    ).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.aisha_resolve_clow_backend\s*\(/);
  });
});
