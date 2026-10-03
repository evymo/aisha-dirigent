/**
 * Gate: LLM gateway naming + provider catalog hygiene
 *
 * Two "gateway" concepts collided in prod: the API gateway (gateway.aisha.guru,
 * the /functions+/rest facade) and the self-hosted LLM gateway (theopenco/llmgateway,
 * internal). The ai_provider_registry `llm-gateway` slug wrongly pointed its
 * endpoint_url at the API-gateway host (gateway.aisha.guru/v1) → every dispatch
 * through it 404'd. This locks the cleanup:
 *   - the llm-gateway provider endpoint is the in-cluster alias (NOT a public
 *     aisha.guru host), and the migrate entrypoint reconciles it to the DERIVED
 *     internal AISHA_LLM_GATEWAY_URL (with an aisha.guru fail-safe);
 *   - openrouter exists as a first-class direct provider (OSS-model aggregator),
 *     enabled when its key is present.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("LLM gateway naming + provider catalog", () => {
  const catalog = read("aisha/db/seed/core/19_ai_provider_catalog.sql");
  const entrypoint = read("scripts/docker-migrate-entrypoint.sh");

  test("llm-gateway provider endpoint is the in-cluster alias, NOT the public API gateway", () => {
    // the row's endpoint_url must be the internal alias, never gateway.aisha.guru
    expect(catalog).toMatch(/'llm-gateway'[^)]*?'http:\/\/llm-gateway:4000\/v1'/);
    expect(catalog).not.toMatch(/'llm-gateway'[^)]*?'https:\/\/gateway\.aisha\.guru/);
  });

  test("migrate entrypoint reconciles the llm-gateway endpoint to the derived URL (aisha.guru fail-safe)", () => {
    expect(entrypoint).toContain("AISHA_LLM_GATEWAY_URL");
    expect(entrypoint).toMatch(/UPDATE public\.ai_provider_registry SET endpoint_url[\s\S]{0,120}slug = 'llm-gateway'/);
    // never re-point at the public API gateway
    expect(entrypoint).toMatch(/\*aisha\.guru\*[\s\S]{0,80}SKIPPED/);
  });

  test("openrouter is registered as a first-class direct provider (OSS aggregator, OpenAI-compat)", () => {
    expect(catalog).toMatch(/'openrouter'[\s\S]{0,140}'https:\/\/openrouter\.ai\/api\/v1'[\s\S]{0,40}'OPENROUTER_API_KEY'/);
    // it is in the dispatch set AISHA can select from (key-wiring + enable land separately)
    expect(catalog).toMatch(/'dispatch_slugs'[\s\S]{0,300}'openrouter'/);
  });
});
