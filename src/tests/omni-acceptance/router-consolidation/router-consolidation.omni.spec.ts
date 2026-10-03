/**
 * Omni acceptance — AREA: router-consolidation (kind: unit)
 *
 * SOURCE OF TRUTH: docs/planning/AISHA_OMNI_GATEWAY.md (v4)
 *   §6.5 mandatory complexity-routing, §7 "Pre-step: konsolidace exekutorů"
 *   (lines 149-157), §20 P0 #1 "Konsolidace routerů" (lines 223, 325).
 *
 * WHAT THIS AREA VERIFIES
 * -----------------------
 * The router consolidation (spec §6, §7, §20 P0 #1) is COMPLETE — the platform has a
 * SINGLE LLM router:
 *   - `services/svc-ai-chat/src/lib/llmRouter.ts`   (CAMEL, authoritative) —
 *     registry + fallback + circuit-breaker + deriveStoreAtProvider; required
 *     field `provider`; nested return `{ text, usage: { inputTokens,
 *     outputTokens }, provider, model }`.
 *   - `services/svc-ai-chat/src/lib/llm-router.ts`  (KEBAB, legacy) — REMOVED.
 *     A thin direct-dispatch router (NO registry/fallback, FLAT token return) whose
 *     only two importers (evaluate.ts, story-consult.ts) were migrated to the camel
 *     router; the dead file was then deleted (§7 step 3) and a lint guard added
 *     against re-introducing the `*-router.ts` kebab pattern (§7 step 4).
 *
 * The consolidation steps (spec §7 lines 149-167), ALL now landed:
 *   1. migrate the 2 importers to the camel router — `provider` via
 *      resolveAvailableModel(model) (capability-availability), read result.usage.*;
 *   2. verify parity (provider resolution + Maestro project/session/lang + token shape);
 *   3. delete llm-router.ts;   4. lint guard against the kebab `*-router.ts` pattern.
 *
 * LIVE (the consolidated state — these stay GREEN; do NOT weaken them):
 *   - the 2 consumers import ONLY the camel router and read nested result.usage.*;
 *   - they route through resolveAvailableModel (capability-availability), not a static
 *     provider — and the same invariant holds repo-wide for every unifiedChat caller;
 *   - the Maestro project/session/lang logic the kebab once held now lives SOLELY in
 *     providers/maestro.ts and still matches the documented conventions;
 *   - no kebab `*-router.ts` dispatch module exists (the §7 step-4 lint guard).
 *
 * SKIP-until-impl: `executeWithFallback` fully replacing story-consult.ts's manual
 *   try/catch fallback (its bespoke Maestro→cloud chain still exists) — kept as it.todo.
 *
 * No top-level import of llmRouter.ts is used (it pulls getRegistry + the whole backend
 * runtime + @aisha/security); source-level assertions use readFileSync (gate-test
 * convention).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

const CAMEL = "services/svc-ai-chat/src/lib/llmRouter.ts";
const KEBAB = "services/svc-ai-chat/src/lib/llm-router.ts";
const EVALUATE = "services/svc-ai-chat/src/routes/evaluate.ts";
const STORY_CONSULT = "services/svc-ai-chat/src/routes/story-consult.ts";
const MAESTRO_PROVIDER = "packages/llm-dispatch/src/providers/maestro.ts";
const CONFIG = "services/svc-ai-chat/src/config.ts";

// The 5 providers in scope per AREA FOCUS (spec §7 line 152 + §5.5 model family).
const PARITY_PROVIDERS = ["openai", "anthropic", "ollama", "vllm", "maestro"] as const;

// ===========================================================================
// 1. POSITIVE — camel router presents the consolidated contract the migration
//    targets (required `provider`, nested `usage`, registry-backed fallback).
// ===========================================================================
describe("router-consolidation · camel llmRouter.ts is the consolidation target [LIVE]", () => {
  it("exists and is the authoritative router (spec §6 row 6, §20 P0 #1)", () => {
    expect(existsSync(join(ROOT, CAMEL))).toBe(true);
  });

  it("UnifiedChatOptions REQUIRES `provider` (no `?`) — callers must wrap resolveProvider(model)", () => {
    const src = read(CAMEL);
    // §7 line 150: "camel `provider` VYŽADUJE → obalit provider: resolveProvider(model)"
    // The field is declared non-optional: `provider: LlmProvider;` (not `provider?:`).
    expect(src).toMatch(/interface UnifiedChatOptions\b/);
    expect(src).toMatch(/\n\s*provider:\s*LlmProvider;/);
    expect(src).not.toMatch(/\n\s*provider\?:\s*LlmProvider;/);
  });

  it("UnifiedChatResult nests tokens under `usage` (NOT flat) — load-bearing return shape (spec §7 line 151)", () => {
    const src = read(CAMEL);
    // camel: `usage: { inputTokens: number; outputTokens: number }`
    expect(src).toMatch(/interface UnifiedChatResult\b/);
    expect(src).toMatch(/usage:\s*\{[\s\S]*?inputTokens:\s*number;[\s\S]*?outputTokens:\s*number;[\s\S]*?\}/);
    // and it must NOT expose flat top-level token fields the kebab router used.
    // Isolate the interface body and assert the token fields appear ONLY nested
    // (indented deeper than 2 spaces, i.e. inside `usage:`), never at top level.
    const body = src.match(/interface UnifiedChatResult\b[\s\S]*?\n\}/)?.[0] ?? "";
    expect(body).not.toBe("");
    // top-level members are indented exactly 2 spaces; a flat token would be `  inputTokens:`
    expect(body).not.toMatch(/\n {2}inputTokens:\s*number;/);
    expect(body).not.toMatch(/\n {2}outputTokens:\s*number;/);
    // the nested form (deeper indent under usage) is required and present
    expect(body).toMatch(/\n {4}inputTokens:\s*number;/);
  });

  it("exposes resolveProvider + executeWithFallback (registry + circuit-breaker) — the resilience camel adds (spec §7 line 154-155)", () => {
    const src = read(CAMEL);
    expect(src).toMatch(/export function resolveProvider\(/);
    expect(src).toMatch(/function executeWithFallback\(/);
    expect(src).toMatch(/recordSuccess|recordFailure/); // circuit-breaker bookkeeping
  });

  it("resolveProvider maps each of the 5 in-scope providers to a distinct LlmProvider value", () => {
    // NOTE: llmRouter.ts is NOT import-safe (top-level `getRegistry()` pulls the
    // whole backend runtime + @aisha/security and throws "All backends failed"
    // under vitest). We therefore re-implement resolveProvider FROM ITS SOURCE
    // (llmRouter.ts:189-209) and (a) assert the source still defines that exact
    // mapping, (b) exercise the replicated function — the same gate-test
    // discipline used for the Maestro parity block below.
    const src = read(CAMEL);
    // Source-fact assertions anchoring the replica to the real file.
    expect(src).toMatch(/if \(m\.startsWith\("maestro"\)\) return "maestro";/);
    expect(src).toMatch(/if \(m\.startsWith\("claude"\)\) return "anthropic";/);
    expect(src).toMatch(/if \(m\.startsWith\("ollama-"\)\) return "ollama";/);
    expect(src).toMatch(/if \(m\.startsWith\("vllm-"\) \|\| m\.startsWith\("local-"\)\) return "vllm";/);
    expect(src).toMatch(/return "openai";/);

    const resolveProvider = (modelString: string): string => {
      const m = modelString.toLowerCase();
      if (m.startsWith("maestro")) return "maestro";
      if (m.startsWith("gemini")) return "google";
      if (m.startsWith("claude")) return "anthropic";
      if (m.startsWith("docker-")) return "docker";
      if (m.startsWith("ollama-")) return "ollama";
      if (m.startsWith("vllm-") || m.startsWith("local-")) return "vllm";
      if (m.startsWith("gateway:") || m.startsWith("llm-gateway:")) return "gateway";
      return "openai";
    };
    expect(resolveProvider("gpt-4o-mini")).toBe("openai");
    expect(resolveProvider("claude-sonnet-4")).toBe("anthropic");
    expect(resolveProvider("ollama-mistral-nemo")).toBe("ollama");
    expect(resolveProvider("vllm-mistral")).toBe("vllm");
    expect(resolveProvider("maestro-story-abc")).toBe("maestro");
    // All 5 in-scope providers resolve distinctly (no collision).
    const resolved = ["gpt-4o-mini", "claude-sonnet-4", "ollama-x", "vllm-x", "maestro-x"].map(resolveProvider);
    expect(new Set(resolved).size).toBe(5);
  });
});

// ===========================================================================
// 2. LIVE RED GUARD (intentionally failing pre-migration) — no kebab import.
//    These flip GREEN exactly when the consolidation lands.
// ===========================================================================
describe("router-consolidation · consumers migrated off kebab llm-router.ts [LIVE]", () => {
  const kebabImportRe =
    /import\s*\{[^}]*\bunifiedChat\b[^}]*\}\s*from\s*['"][^'"]*\/llm-router(?:\.js)?['"]/;

  it("evaluate.ts MUST NOT import from llm-router.ts (kebab) — should import llmRouter.ts (camel)", () => {
    // Spec §7 line 150 + line 40: evaluate.ts:8 imports the kebab today.
    // RED now (proves pre-migration state); GREEN after `provider: resolveProvider(model)` wrap.
    const src = read(EVALUATE);
    expect(src).not.toMatch(kebabImportRe);
  });

  it("story-consult.ts MUST NOT import from llm-router.ts (kebab) — should import llmRouter.ts (camel)", () => {
    // Spec §7 line 150 + line 40: story-consult.ts:20 imports the kebab today.
    const src = read(STORY_CONSULT);
    expect(src).not.toMatch(
      /from\s*['"][^'"]*\/llm-router(?:\.js)?['"]/,
    );
  });

  it("evaluate.ts reads nested result.usage.* (NOT flat result.inputTokens) [LIVE]", () => {
    // Spec §7 line 151: rewrite reads at evaluate.ts:101 to result.usage.*.
    const src = read(EVALUATE);
    // RED now: today it does `result.inputTokens + result.outputTokens` (:101).
    expect(src).not.toMatch(/result\.inputTokens/);
    expect(src).not.toMatch(/result\.outputTokens/);
  });

  it("story-consult.ts reads nested result.usage.* (NOT flat result.inputTokens) [LIVE]", () => {
    // Spec §7 line 151: rewrite reads at story-consult.ts:346-376 to result.usage.*.
    const src = read(STORY_CONSULT);
    expect(src).not.toMatch(/result\.inputTokens/);
    expect(src).not.toMatch(/result\.outputTokens/);
    // also the kebab-only `LlmResult` type import must be gone.
    expect(src).not.toMatch(/type\s+LlmResult\b[\s\S]*?from\s*['"][^'"]*\/llm-router/);
  });

  it("consumers route through capability-availability dynamic selection (resolveAvailableModel), NOT a static provider [LIVE]", () => {
    // The point of the camel router is DYNAMIC selection (ZADÁNÍ §2.4 capability-
    // availability / "uses what it has"). A static `provider: resolveProvider(model)`
    // is NOT enough — on an instance where the preferred provider has no key,
    // unifiedChat throws "No available backend" (it does NOT remap internally). The
    // canonical idiom (orchestrationBridge.ts:1255/1263, reflection/decision.ts:196)
    // is resolveAvailableModel(preferred) → {model, provider} → unifiedChat(...),
    // which remaps to a CONFIGURED backend. BOTH consumers must use it — this guard
    // fails a mechanical kebab→camel swap that wires only a static provider.
    const evalSrc = read(EVALUATE);
    const consultSrc = read(STORY_CONSULT);
    const usesCapabilityAvailability = (s: string) => /resolveAvailableModel\s*\(/.test(s);
    expect(usesCapabilityAvailability(evalSrc), 'evaluate.ts must use resolveAvailableModel').toBe(true);
    expect(usesCapabilityAvailability(consultSrc), 'story-consult.ts must use resolveAvailableModel').toBe(true);
  });
});

// ===========================================================================
// 3. NEGATIVE — camel REQUIRES provider; an unprovider'd call must fail
//    predictably, never silently mis-route. (AREA FOCUS NEGATIVE.)
// ===========================================================================
describe("router-consolidation · camel fails predictably without provider [LIVE]", () => {
  it("kebab call signature (no `provider`) is INCOMPATIBLE with camel UnifiedChatOptions (compile-time guard documented)", () => {
    // The kebab call sites pass `unifiedChat({ model, messages, ... })` with NO
    // `provider`. Under camel this is a *type error* (provider is required) — the
    // migration is forced to add it; it can NEVER compile to a silent default.
    // We assert the structural facts that make the omission un-silenceable:
    const camelSrc = read(CAMEL);
    // (a) provider is required (asserted above) AND
    // (b) there is NO default-provider branch that would mask an omitted provider.
    //     The only provider defaulting in camel is the EXPLICIT `opts.provider === 'gateway'`
    //     dispatch and PROVIDER_TO_BACKEND_ID lookup keyed by opts.provider — both
    //     read opts.provider directly; an undefined provider yields a thrown
    //     "No available backend ... (provider: undefined)" error, not a default route.
    expect(camelSrc).toMatch(/PROVIDER_TO_BACKEND_ID\[opts\.provider\]/);
    expect(camelSrc).toMatch(/No available backend for model[^]*provider:\s*\$\{opts\.provider\}/);
    // No `opts.provider ?? ` / `opts.provider || ` defaulting anywhere.
    expect(camelSrc).not.toMatch(/opts\.provider\s*\?\?/);
    expect(camelSrc).not.toMatch(/opts\.provider\s*\|\|/);
  });

  it("camel throws (does not return) when no backend resolves for the (model, provider) pair", () => {
    const camelSrc = read(CAMEL);
    // unifiedChat throws Error rather than returning a partial/empty result.
    expect(camelSrc).toMatch(/throw new Error\([^]*No available backend for model/);
  });
});

// ===========================================================================
// 4. FALSE-POSITIVE — guards that the migration does NOT introduce a wrong
//    thing. (AREA FOCUS FALSE-POSITIVE.)
// ===========================================================================
describe("router-consolidation · false-positive guards [LIVE]", () => {
  it("lint guard: NO source file imports the kebab llm-router.ts (consolidation complete)", () => {
    // Spec §7 line 157. Post-consolidation the only legitimate `llm-router` import is none.
    const offenders = [EVALUATE, STORY_CONSULT].filter((f) =>
      /from\s*['"][^'"]*\/llm-router(?:\.js)?['"]/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("lint guard (§7 step 4): the kebab llm-router.ts is GONE and no `*-router.ts` dispatch module replaces it", () => {
    // §7 line 167: "lint guard proti `*-router.ts` vs `*Router.ts`". The kebab was deleted
    // (§7 step 3); re-introducing a hyphenated dispatch-router (no registry/fallback/
    // circuit-breaker/storeAtProvider) is the regression this guard forbids. Only the camel
    // `llmRouter.ts` may live in svc-ai-chat/src/lib.
    expect(existsSync(join(ROOT, KEBAB))).toBe(false);
    const libDir = join(ROOT, "services/svc-ai-chat/src/lib");
    const kebabRouters = readdirSync(libDir).filter((f) => /-router\.ts$/.test(f));
    expect(kebabRouters, `kebab routers must not exist in lib/: ${kebabRouters.join(", ")}`).toEqual([]);
  });

  it("NO channel-default / consumer uses a bare `llama*` or `qwen*` model string (kebab→local, camel→OPENAI mis-route)", () => {
    // Spec §7 line 152: "ověřit, že žádný channel config nepoužívá `llama/qwen` zkratku".
    // kebab resolveProvider maps bare `llama`/`qwen` → 'local' (vLLM-class, private);
    // camel maps them → 'openai' (CLOUD). A surviving bare shortcut would silently
    // ship a local-intended model to a cloud provider after migration — a
    // confidentiality regression. Codebase uses `ollama-*` prefixes, which are
    // camel-safe. This guard fails if anyone reintroduces the bare shortcut.
    const filesToScan = [EVALUATE, STORY_CONSULT, CONFIG,
      "services/svc-ai-chat/src/lib/orchestrationBridge.ts",
      "services/svc-ai-chat/src/lib/defaultModel.ts"];
    const bareShortcut = /['"`](llama|qwen)[\w.-]*['"`]/i;
    for (const f of filesToScan) {
      if (!existsSync(join(ROOT, f))) continue;
      const src = read(f);
      // strip comments/doc lines to avoid false hits on prose
      const codeOnly = src
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(codeOnly, `${f} must not use a bare llama/qwen model shortcut`).not.toMatch(bareShortcut);
    }
  });

  it("camel deriveStoreAtProvider keeps cloud providers closed-by-default — migration must not relax this", () => {
    // The kebab router had no store policy; the camel router's closed-by-default
    // store policy must survive consolidation (cloud/maestro/gateway → false).
    const camelSrc = read(CAMEL);
    expect(camelSrc).toMatch(/function providerIsLocal\(/);
    // local-only opt-in; everything else returns false.
    expect(camelSrc).toMatch(/Cloud \/ gateway \/ maestro \/ unknown: closed by default[\s\S]*?return false;/);
  });
});

// ===========================================================================
// 5. POSITIVE — Maestro parity: extractMaestroProjectId (kebab) ≡ extractProjectId
//    (camel provider) + session extraction + INSIGHT_DEFAULT_LANG parity.
//    (AREA FOCUS: Maestro parity.)
// ===========================================================================
describe("router-consolidation · Maestro extract/session/lang parity [LIVE]", () => {
  // The canonical Maestro project-id extraction — now SOLELY in camel
  // providers/maestro.ts:67-72 (formerly mirrored in the removed kebab
  // llm-router.ts:260-265). Re-implemented here from the surviving source to
  // exercise the documented conventions behaviorally.
  function extractProjectId(model: string): string {
    const m = model.toLowerCase();
    if (m === "maestro-default" || m === "maestro") return "aisha";
    if (m.startsWith("maestro-")) return model.slice("maestro-".length);
    return "aisha";
  }

  it("the surviving camel Maestro provider retains the project-id extraction logic (no loss on consolidation)", () => {
    // §7 line 152: "Maestro `callMaestro` JE replikováno v lib/providers/maestro.ts, neztratí se".
    // The kebab llm-router.ts was removed (§7 step 3); its callMaestro project-id logic now
    // lives SOLELY in providers/maestro.ts — assert it carries the documented convention.
    const maestroSrc = read(MAESTRO_PROVIDER);
    expect(maestroSrc).toMatch(/function extractProjectId\(/);
    expect(maestroSrc).toMatch(/maestro-default["']?\s*\|\|\s*m === ["']maestro["']\)\s*return ["']aisha["']/);
    expect(maestroSrc).toMatch(/startsWith\(["']maestro-["']\)\)\s*return model\.slice\(["']maestro-["']\.length\)/);
  });

  it("project-id extraction yields the documented value for every model convention", () => {
    const cases: Array<[string, string]> = [
      ["maestro", "aisha"],
      ["maestro-default", "aisha"],
      ["maestro-story-11111111-2222-3333-4444-555555555555", "story-11111111-2222-3333-4444-555555555555"],
      ["maestro-sandbox-run42", "sandbox-run42"],
      ["Maestro-Default", "aisha"], // case-insensitive (lowercased `m`)
      ["maestro-aisha", "aisha"],
    ];
    for (const [model, expected] of cases) {
      expect(extractProjectId(model), `extraction for ${model}`).toBe(expected);
    }
  });

  it("session_id extraction regex /session-([a-zA-Z0-9-]+)/ retained in the camel Maestro provider", () => {
    // camel providers/maestro.ts:171 — the regex the kebab also used (kebab now removed).
    const maestroSrc = read(MAESTRO_PROVIDER);
    const sessionRe = /match\(\/session-\(\[a-zA-Z0-9-\]\+\)\/\)/;
    expect(maestroSrc).toMatch(sessionRe);
    // behavioral check on the pattern
    const re = /session-([a-zA-Z0-9-]+)/;
    expect("maestro-story-x-session-abc123".match(re)?.[1]).toBe("abc123");
    expect("maestro-default".match(re)).toBeNull(); // no session → fresh server-side session
  });

  it("INSIGHT_DEFAULT_LANG parity: config.insightDefaultLang === (INSIGHT_DEFAULT_LANG ?? 'cs-CZ')", () => {
    // §7 line 152: "ověřit `config.insightDefaultLang` == `INSIGHT_DEFAULT_LANG ?? 'cs-CZ'`".
    // camel maestro provider uses process.env.INSIGHT_DEFAULT_LANG ?? 'cs-CZ' (maestro.ts:179),
    // the same default config.insightDefaultLang resolves to — the lang the kebab consumed
    // before it was removed, so no lang regression on consolidation.
    const configSrc = read(CONFIG);
    const maestroSrc = read(MAESTRO_PROVIDER);
    expect(configSrc).toMatch(/insightDefaultLang:\s*process\.env\.INSIGHT_DEFAULT_LANG\s*\?\?\s*['"]cs-CZ['"]/);
    expect(maestroSrc).toMatch(/process\.env\.INSIGHT_DEFAULT_LANG\s*\?\?\s*["']cs-CZ["']/);
  });
});

// ===========================================================================
// 6. POSITIVE — text + token-accounting parity across 5 providers × stream/non.
//    The behavioral parity matrix (identical text + identical token accounting)
//    needs a runnable migrated unifiedChat over fakeable backends. The camel
//    streaming path (unifiedChatStream) does NOT exist yet (spec §7 line 162),
//    so the stream half is SKIP-until-impl. The non-stream token-shape mapping
//    is asserted at the source level (LIVE) below.
// ===========================================================================
describe("router-consolidation · token-accounting shape parity (non-stream) [LIVE]", () => {
  it("camel toUnifiedResult forwards backend usage verbatim into result.usage (no loss/rename)", () => {
    // The migrated consumers' token totals (evaluate.ts tokens_used,
    // story-consult.ts p_tokens_input/p_tokens_output) depend on result.usage
    // carrying the backend's {inputTokens, outputTokens} unchanged.
    const camelSrc = read(CAMEL);
    expect(camelSrc).toMatch(/function toUnifiedResult\(/);
    expect(camelSrc).toMatch(/usage:\s*resp\.usage/);
    expect(camelSrc).toMatch(/text:\s*resp\.text/);
  });

  it("camel usage.* is the SINGLE token contract — no flat top-level token fields survive the consolidation", () => {
    // The kebab's flat result.{inputTokens,outputTokens} were the migration's rename SOURCE;
    // post-deletion the camel nested usage.* is the only token shape. Assert the router result
    // exposes tokens ONLY nested under usage (no flat top-level token field remains anywhere).
    const camelSrc = read(CAMEL);
    const resultBody = camelSrc.match(/interface UnifiedChatResult\b[\s\S]*?\n\}/)?.[0] ?? "";
    expect(resultBody).not.toBe("");
    expect(resultBody).not.toMatch(/\n {2}inputTokens:\s*number;/); // no flat top-level token
    expect(resultBody).toMatch(/usage:\s*\{[\s\S]*?inputTokens:\s*number;/); // nested only
  });
});

describe.skip("router-consolidation · stream==non-stream parity matrix [SKIP-until-impl]", () => {
  /**
   * CONTRACT (spec §7 line 162, §20 P0 #2, line 325):
   *   After `unifiedChatStream()` is added to llmRouter.ts and `chat()` is
   *   re-expressed as "consume + accumulate over the shared `_executeCall`",
   *   a CI matrix MUST run the SAME assertions for every provider in
   *   PARITY_PROVIDERS (openai, anthropic, ollama, vllm, maestro) under BOTH
   *   stream=true and stream=false, asserting:
   *     (a) identical accumulated `.text`, and
   *     (b) identical `.usage.inputTokens` / `.usage.outputTokens`.
   *   No provider may get different coverage.
   *
   * Implement by injecting fake InferenceBackend impls into the registry (one
   * per provider) that return a fixed {text, usage} for non-stream and emit the
   * same text as chunks + a final usage for stream, then assert chat() (buffered)
   * and the accumulation of chatStream() yield byte-identical results.
   *
   * Do NOT top-level import llmRouter here — use a dynamic import inside the test
   * once unifiedChatStream/_executeCall exist (they do not today).
   */
  it.todo(
    `chat()==accumulate(chatStream()) text+usage for each of: ${PARITY_PROVIDERS.join(", ")}`,
  );
});

// ===========================================================================
// 7. SKIP-until-impl — fallback resilience parity after migration.
// ===========================================================================
describe.skip("router-consolidation · executeWithFallback replaces manual try/catch [SKIP-until-impl]", () => {
  /**
   * CONTRACT (spec §7 line 154):
   *   "po migraci story-consult.ts smazat jeho ručně psaný try/catch fallback
   *    (:262,:285) — camel `executeWithFallback` dá registry-backed chain
   *    zdarma (resilience upgrade)."
   *
   * Acceptance once migrated:
   *   - story-consult.ts no longer contains the bespoke Maestro→cloud try/catch
   *     fallback (the second `unifiedChat(... fallbackModel ...)` call at :285 is gone),
   *   - a single unifiedChat call relies on camel executeWithFallback for the
   *     primary→next-backend chain (recordFailure/recordSuccess circuit-breaker),
   *   - on first-backend failure the registry advances to the next backend and
   *     records a failure, transparently to the caller (no second call site).
   *
   * This is RED-by-construction today (the manual fallback at :279-311 still
   * exists). Kept as it.todo so it never silently passes pre-migration.
   */
  it.todo("story-consult.ts has no manual Maestro→cloud try/catch; relies on executeWithFallback");
});

// ===========================================================================
// 5. REPO-WIDE capability-availability INVARIANT [LIVE]
//    Every unifiedChat caller MUST route the model through dynamic capability-
//    availability (resolveAvailableModel) or dispatchDecision (which chains it).
//    A static `provider: resolveProvider(model)` throws "No available backend"
//    on a selectively-configured instance (e.g. only ANTHROPIC_API_KEY set).
//    This makes the painted-over static-proxy detectable REPO-WIDE — not just
//    for the two already-migrated routes. (Final plan §22.1 gap #1 / §22.3.)
//    Expected RED today for the 4 un-migrated clusters; flips GREEN at step E1-1.
// ===========================================================================
describe("router-consolidation · capability-availability invariant across ALL unifiedChat callers [LIVE]", () => {
  const DIRECT_UNIFIEDCHAT_CALLERS = [
    EVALUATE,
    STORY_CONSULT,
    "services/svc-ai-chat/src/lib/proactiveEngine.ts",
    "services/svc-ai-chat/src/routes/generate.ts",
    "services/svc-ai-chat/src/lib/workflowEngine.ts",
    "services/svc-ai-chat/src/lib/criticLoop.ts",
  ];

  for (const f of DIRECT_UNIFIEDCHAT_CALLERS) {
    const name = f.split("/").pop();
    it(`${name} routes unifiedChat through resolveAvailableModel/dispatchDecision, not a static provider [LIVE]`, () => {
      if (!existsSync(join(ROOT, f))) return; // file moved → skip (do not false-fail)
      const src = read(f);
      if (!/unifiedChat\s*\(/.test(src)) return; // not a direct unifiedChat caller → out of scope
      // Truly-correct dynamic capability-availability, at EITHER layer:
      //   - router-level: resolveAvailableModel() (or dispatchDecision(), which chains it), OR
      //   - orchestration-level: the backend was picked by aisha_resolve_clow_backend (the DB
      //     resolver already scored CONFIGURED/healthy backends) and dispatched with its explicit
      //     creds — e.g. criticLoop's resolver-picked judge. Both are dynamic selection; a raw
      //     model-string + static resolveProvider is NOT.
      const dynamic =
        /resolveAvailableModel\s*\(/.test(src) ||
        /dispatchDecision\s*\(/.test(src) ||
        /aisha_resolve_clow_backend/.test(src);
      const staticProxy = /provider:\s*resolveProvider\s*\(/.test(src) && !dynamic;
      expect(
        dynamic,
        `${f} calls unifiedChat but does NOT route through resolveAvailableModel/dispatchDecision ` +
          `(static-proxy=${staticProxy}) → throws "No available backend" on a selectively-configured ` +
          `instance. Final plan §22.1 #1 / step E1-1.`,
      ).toBe(true);
    });
  }
});
