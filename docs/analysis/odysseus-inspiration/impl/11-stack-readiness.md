# Impl 11 — Readiness vnitřního stacku: skoro vše je „zapojit/rozšířit", ne „stavět"

> Hloubkový audit vnitřního stacku potvrdil hypotézu: **příprava je v pokročilém stavu.** Skoro každá položka z 01–10 má už hotové scaffolding a jde jen o **wire-up / extend**, ne build. Níže per položka: co už existuje (s důkazy file:line) → přesný extension point → effort.

---

## 0. Headline tabulka

| Položka | Stav scaffoldingu | Co chybí (extension) | Effort |
|---------|-------------------|----------------------|--------|
| **01 dynamický výběr toolů** | **AISHA už počítá `RoutePlan.toolsAllowlist`** (`route_task` RPC) — `chat.ts:538` ho má, ale `ř.592` načítá z `channelConfig.allowed_tools` | **jen zapojit**: protnout `channelToolNames` s `aishaRoutePlan.toolsAllowlist` před `loadToolsByNames` | **XS** |
| **03 context budget** | `ContextBundle.tokenBudget/tokensUsed` **už plní** `compose_context` RPC (orchestrationBridge:618); `budgetEnforcement` flag existuje (reflection/config) | **jen vynutit**: check `tokensUsed>budget` → kompakce; `computeInputBudget` čte existující `ai_model_registry.context_window` | **S** |
| **Streaming** | `chatStream?()` v `InferenceBackend` (types.ts:175), `unifiedChatStream()` router + fallback, `parseOpenAISSE`, funkční v openai-compat | Anthropic backend `chatStream()` (nativní SSE parser) | **S** |
| **Structured output** | `jsonMode?` v `ChatRequest` (types.ts:60) + `UnifiedChatOptions` (llmRouter:107) + proplumbováno (llmRouter:433); funkční v openai/openai-compat | Anthropic backend `jsonMode` handling; (grammar `output_config` = rozšíření téhož pole) | **S** |
| **Batch** | `batchSubmitter` (Anthropic+OpenAI) + `aisha_choose_execution_strategy` + `ai_batch_jobs` + `WF_BATCH_POLLER` | jen směrovat nové offline workloady | **XS** |
| **Warm config `ai_runtime`** | `runtime-config.ts getRunnerCaps` (TTL cache, DB>env, fail-safe) + `get_system_config`/`set_system_config_admin` RPC | kopie patternu pro klíč `ai_runtime` | **XS** |
| **CLOW purposes (governance)** | `PURPOSE_TO_CLOW` mapa + purpose-agnostický `aisha_resolve_clow_backend` RPC; **0 DB změn** na nový purpose | přidat union + map entry pro `chat.history_compaction`, `research.*` | **XS** |
| **Prompt caching** | `ai_model_registry.cached_input_price_per_m` + `provider_metadata` existují | centrální pole `cacheControl` v `ChatRequest`, `cacheReadTokens` v `ChatResponse.usage`, build+parse v anthropic.ts, `ModelUsage` rozšířit | **S** |
| **02 untrusted wrapper** | ingestion-safety (ingest-time) existuje; runtime wrapper NE | jediná opravdu nová (malá) věc: `untrusted.ts` (3 fn) | **S** |
| **Citations** | home-grown provenance (`decisionProvenance`/`knowledgeIntegrity`) | volitelně pole `citations` v `ChatResponse` (Anthropic-only) | **M, opt** |
| **Context editing** | naše kompakce (03) pokryje cross-provider | volitelně Anthropic block-index protokol | **M, opt** |

**Závěr:** 6 položek je **XS/S wire-up nad hotovým scaffoldingem**, 1 je malá nová věc (02), 2 jsou volitelné Anthropic-only. **Žádná velká stavba.**

---

## 1. Dva zásadní reframe (silnější než původní návrh)

### 1.1 impl 01 — NEbudovat `resolveToolSet`, ZAPOJIT existující `route_task` allowlist
- **Důkaz:** `RoutePlan.toolsAllowlist: string[]` (orchestrationBridge:75), plněno `routeViaAisha()` → `route_task` RPC (ř.467–523). V `chat.ts:523` se `routeViaAisha` **volá** a `aishaRoutePlan` se nastaví (ř.538) — ale tooly se v `ř.592` berou z `channelConfig.allowed_tools`, **`toolsAllowlist` se neaplikuje**.
- **Reframe:** dynamický výběr toolů **už existuje a je AISHA-governed** (route_task = AISHA/Dirigent rozhoduje). Práce = **protnout**:
  ```ts
  let names = Array.isArray(channelConfig.allowed_tools) ? channelConfig.allowed_tools : [];
  if (aishaRoutePlan?.toolsAllowlist?.length) {
    names = names.filter(n => aishaRoutePlan.toolsAllowlist.includes(n)); // AISHA zúžení v rámci channel práv
  }
  const toolDefs = await toolExecutor.loadToolsByNames(names);
  ```
- **Důsledek:** žádný nový `resolveToolSet`, žádný intent-engine, žádná embedding tabulka. **Lepší governance** (route_task) i **menší kód** než původní 01. Intent-routing/embeddings = jen fallback, pokud `route_task` allowlist nestačí.
- **Caching-tenze (impl 10) zůstává:** na Anthropic zvážit, zda zúžení nerozbíjí cache tool bloku → provider-aware (zúžit hlavně pro lokální modely).

### 1.2 impl 03 — NEbudovat budget infra, VYNUTIT existující `ContextBundle`
- **Důkaz:** `ContextBundle { tokenBudget, tokensUsed }` (orchestrationBridge:109) **už plní** `compose_context` RPC (ř.618: `token_budget`/`tokens_used`). `budgetEnforcement` flag existuje (reflection/config). Ale nikde není `if (tokensUsed > tokenBudget) → trim/compact`.
- **Reframe:** budget **data už tečou**; chybí jen **akce**. Práce = `computeInputBudget` (čte existující `ai_model_registry.context_window`) + kompakce glue, navázané na už-přítomné `tokensUsed/tokenBudget`. Žádná migrace, žádná nová budget infra.

---

## 2. Anthropic backend feature-parity (jeden workstream)
Streaming + structured output + caching mají **centrální scaffolding** (unified `ChatRequest`/`ChatResponse`/`InferenceBackend`); chybí jen **paritní implementace v `anthropic.ts`** + pár centrálních polí. Udělat jako **jeden balíček** (vzor `openai-compat.ts`):
- `chatStream()` metoda (nativní Anthropic SSE → `UnifiedStreamChunk`).
- `jsonMode` handling v build body (vzor openai.ts:146–157); později grammar `output_config`.
- `cache_control` na system+tools (impl 10) + parse `usage.cache_read_input_tokens`.
- Centrálně: `ChatRequest.cacheControl?`, `ChatResponse.usage.cacheReadTokens?`, `ModelUsage.cacheReadTokens?` (jednou, propaguje do všech providerů).
Tím Anthropic backend dožene OpenAI-compat a všechny tři schopnosti se zapnou.

---

## 3. CLOW purposes + warm config = triviální kopie
- **Purpose:** `RagPurpose` union + `PURPOSE_TO_CLOW` entry (capability-resolver.ts:42–173). RPC purpose-agnostický → **0 DB změn**. Přidat `chat.history_compaction`, `research.reasoning`, `research.extract` = pár řádků.
- **Warm config:** zkopírovat `getRunnerCaps` (runtime-config.ts) → `getAiRuntimeConfig()` pro klíč `ai_runtime`. RPC `get_system_config`/`set_system_config_admin` live.

---

## 4. Jediná opravdu nová (malá) věc: 02 untrusted wrapper
Ingestion-safety je ingest-time; runtime „data ne instrukce" wrapper na LLM boundary chybí. To je jediný net-new modul (`packages/security/untrusted.ts`, 3 fn) — a i ten reuse `scanForInjection` pro re-scan. Vše ostatní = extend.

---

## 5. Dopad na zadání (08) — přesnější a menší
1. **01 → wire-up** `aishaRoutePlan.toolsAllowlist` v chat.ts (ne nový resolveToolSet). 
2. **03 → enforce** existující `ContextBundle` (ne nová budget infra).
3. **Anthropic parity** (stream+jsonMode+cache) jako jeden balíček nad hotovým unified layerem.
4. **Purpose/warm config** = kopie patternů (XS).
5. **02** zůstává jediná malá nová věc.
6. Caching pole (`cacheControl`/`cacheReadTokens`) = centrální, propagují se všem providerům.

**Net:** balík se scvrkl na **wire-up + jeden parity balíček + jeden malý modul**. Potvrzeno: příprava je pokročilá, jde převážně o rozšíření. Effort drtivě XS/S.

---

## 6. Doporučené pořadí (po readiness)
1. **01 wire toolsAllowlist** (XS, okamžitá hodnota, AISHA už rozhoduje).
2. **Warm config `ai_runtime` + CLOW purposes** (XS, odblokuje prahy a governance pro zbytek).
3. **03 enforce ContextBundle** (S).
4. **Anthropic parity balíček** (stream+jsonMode+caching) (S) — největší cost/UX dopad.
5. **02 untrusted wrapper** (S).
6. **Batch směrování** offline workloadů (XS).
7. **Opt:** citations / context editing (Anthropic-only), 01 embeddings v2 — jen při měřené potřebě.
