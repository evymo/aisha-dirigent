/**
 * Gate A-3 (odysseus impl/12 §A): Anthropic request bodies are built
 * EXCLUSIVELY by prepareAnthropicBody — no path (sync/stream/batch) may
 * hand-roll one.
 *
 * Why: the moment caching/jsonMode/structured/thinking land in one builder
 * and a second path assembles bodies inline, sync and batch drift — batch
 * runs silently lose caching (−90 % on cache reads stacked with the −50 %
 * batch rate) and json/thinking semantics. The deep-equality invariant (A-1)
 * lives in packages/llm-dispatch __tests__ (chat() posts exactly the builder
 * output); this gate statically pins the call-site topology:
 *   1. the shared builder is exported from @aisha/llm-dispatch,
 *   2. the reflection generator batch node builds via the builder,
 *   3. nobody else POSTs to the Anthropic Messages endpoint,
 *   4. cache usage fields exist so cost accrual can read cached rates.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const ANTHROPIC_PROVIDER = "packages/llm-dispatch/src/providers/anthropic.ts";
const GENERATOR = "services/svc-ai-chat/src/reflection/nodes/generator.ts";
const BATCH_SUBMITTER = "services/svc-ai-chat/src/lib/batchSubmitter.ts";

/** Files allowed to talk to api.anthropic.com directly. */
const MESSAGES_ENDPOINT_ALLOWLIST = new Set([
  ANTHROPIC_PROVIDER, // chat() + chatStream() — both via prepareAnthropicBody
  BATCH_SUBMITTER, // /v1/messages/batches transport — params come prebuilt from the builder
]);

function trackedFilesMatching(pattern: string): string[] {
  const out = execSync(`git grep -l ${JSON.stringify(pattern)} -- 'services/**/*.ts' 'packages/**/*.ts' src`, {
    cwd: ROOT,
    encoding: "utf-8",
  })
    .split("\n")
    .filter(Boolean)
    // tests may mention the endpoint in fixtures/spec text
    .filter((f) => !/\.test\.ts$|__tests__|\/tests\//.test(f));
  return out;
}

describe("Anthropic body builder — one-builder topology (A-3)", () => {
  test("prepareAnthropicBody is the exported shared builder", () => {
    const provider = read(ANTHROPIC_PROVIDER);
    expect(provider).toMatch(/export function prepareAnthropicBody/);
    const barrel = read("packages/llm-dispatch/src/providers/index.ts");
    expect(barrel).toMatch(/prepareAnthropicBody/);
  });

  test("chat() and chatStream() both consume the builder (no inline body assembly)", () => {
    const provider = read(ANTHROPIC_PROVIDER);
    const chatUses = (provider.match(/prepareAnthropicBody\(request\)/g) ?? []).length;
    expect(chatUses, "sync chat() AND chatStream() must call the builder").toBeGreaterThanOrEqual(2);
  });

  test("reflection generator batch node builds the Anthropic body via the builder", () => {
    const gen = read(GENERATOR);
    expect(gen).toMatch(/prepareAnthropicBody\(/);
    expect(
      /batchProvider === 'anthropic'\s*\?[^:]*\{\s*model,\s*max_tokens/.test(gen),
      "generator must not hand-assemble an Anthropic batch body",
    ).toBe(false);
  });

  test("no untracked caller POSTs to the Anthropic Messages endpoint", () => {
    for (const file of trackedFilesMatching("api.anthropic.com/v1/messages")) {
      expect(
        MESSAGES_ENDPOINT_ALLOWLIST.has(file),
        `${file} must not talk to the Anthropic Messages endpoint directly — use @aisha/llm-dispatch`,
      ).toBe(true);
    }
  });

  test("cache usage fields are first-class so cost accrual reads cached rates (B-2)", () => {
    const types = read("packages/llm-dispatch/src/providers/types.ts");
    expect(types).toMatch(/cacheReadTokens\?:\s*number/);
    expect(types).toMatch(/cacheCreationTokens\?:\s*number/);
    const provider = read(ANTHROPIC_PROVIDER);
    expect(provider).toMatch(/cache_read_input_tokens/);
    expect(provider).toMatch(/cache_creation_input_tokens/);
  });

  test("stable-prefix contract exists on the unified request (impl/10 §1)", () => {
    const types = read("packages/llm-dispatch/src/providers/types.ts");
    expect(types).toMatch(/systemPromptStable\?:\s*string/);
  });
});
