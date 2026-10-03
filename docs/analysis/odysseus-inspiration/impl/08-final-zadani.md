# Impl 08 — Ověřené finální zadání (reuse-maximal, minimální net-new)

> **Autoritativní dokument.** Tam, kde se liší od scope v 01–07, platí toto. Vzniklo finálním průchodem celého balíku proti reálnému kódu s jediným cílem: **žádná vícepráce, žádné nové komponenty/funkce, pokud nejsou bezpodmínečně nutné; maximální využití hotového.**

---

## 0. Korekce po ověření v kódu (co se NEpíše, protože už existuje)

Tyto nálezy ruší část původně navržené práce v 01/03/07:

| Původně navrženo | Realita v kódu | Důsledek |
|------------------|----------------|----------|
| Migrace `ai_model_registry` + `context_window`, `max_output_tokens` | **Sloupce už existují** (`aisha/db/sql/tables/ai_model_registry.sql`) | **Žádná migrace.** Jen pro-wire skrz `modelDiscovery`. Odpadá types/rpc/baseline řetězec pro tuto část. |
| Nový `tokenCount.ts` + js-tiktoken (nová dependency) | `estimateTokens()` už existuje (`Math.ceil(len/4)`) | **Reuse**, žádná nová dependency. Jen zcentralizovat do sdíleného importu. |
| Nový keyword-hint engine pro výběr toolů | `analyzeChatQueryIntent(msg): ChatQueryIntent` už existuje (rule/document/hybrid/greeting/general) + rodiny `AUTHENTICATED_TOOLS`/`AITG_TOOLS`/`FLOWBOARD_TOOLS` jako Sety | **Reuse** — tool routing z existujícího intentu, žádný nový klasifikátor. |
| Nová tabulka `agent_tool_embeddings` + `match_agent_tools` RPC + rebuild skript | Není potřeba pro nutné jádro | **Odloženo** do v2 (jen pokud intent-routing nestačí, měřeno Langfuse). |
| Nový warm settings RPC | `get_system_config(p_key,...)` + `set_system_config_admin(...)` (audited, admin-only, optimistic concurrency) už existují | **Reuse 1:1**, žádný nový RPC. |
| Nový Appsmith panel | Vzor `aitg-automation-control.template.json` + `set_system_config_admin` | Reuse vzoru; panel = konfigurace, ne nová komponenta. Volitelné — lze i jen NocoDB. |
| `createPinnedSsrfGuard` (undici dispatcher) | `safeFetch()` už blokuje rebinding single-lookupem (přiznáno „good enough for typical") | Pinning **odloženo** (hardening). Nutné jádro = univerzální použití existujícího `safeFetch`. |

---

## 0b. Stack readiness (viz [11](11-stack-readiness.md)) — skoro vše je wire-up, ne build
Hloubkový audit potvrdil pokročilou přípravu. Dva reframe nad rámec §0:
- **01 → ZAPOJIT, ne stavět:** `RoutePlan.toolsAllowlist` (z `route_task` RPC) AISHA **už počítá** (`chat.ts:538`), jen se neaplikuje (ř.592 bere `channelConfig.allowed_tools`). Práce = protnout je. Žádný `resolveToolSet`, žádný intent-engine, žádná tabulka. Intent/embeddings = fallback při potřebě.
- **03 → VYNUTIT, ne stavět:** `ContextBundle.tokenBudget/tokensUsed` **už plní** `compose_context` (orchestrationBridge:618); `budgetEnforcement` flag existuje. Chybí jen check+kompakce. Žádná budget infra.
- **Anthropic parity balíček:** streaming/structured/caching mají centrální scaffolding (`chatStream?` v `InferenceBackend`, `jsonMode` proplumbováno, registry `cached_input_price_per_m`); chybí jen paritní implementace v `anthropic.ts` + pár centrálních polí. Jeden balíček.
- **Purpose + warm config** = kopie hotových patternů (`PURPOSE_TO_CLOW`, `getRunnerCaps`), 0 DB změn / XS.

## 1. Princip finálního zadání
1. **Reuse > add.** Každý impl primárně zapojuje hotové: `embed-dispatcher`, `aisha_resolve_clow_backend`, `analyzeChatQueryIntent`, `canUseTool`, `scanForInjection`, `knowledgeIntegrity`, `estimateTokens`, `get/set_system_config`, `runtime-config.ts` vzor, `safeFetch`, `criticLoop`, `compose_context`, `llmRouter`, `tracer`(Langfuse), `ai_model_registry`, `models-check`, cold-start probe/doctor vzory, Appsmith audited-RPC vzor, `audit_journal`.
2. **Net-new jen když bezpodmínečně nutné** — viz §3 (taxativní seznam, vše ostatní zakázáno bez schválení).
3. **Vrstvy v 2: necessary core** (levné, bez DB kde to jde) **vs deferred** (měřením podložené).
4. Vše za **feature flagem** s parity-fallbackem na dnešní chování.

---

## 2. Necessary core per impl (reuse-maximal)

### 02 — Untrusted wrapper
- **Net-new (nutné, minimální):** `packages/security/src/untrusted.ts` — 3 čisté funkce (`wrapUntrusted`, `escapeGuardMarkers`, `UNTRUSTED_POLICY_PREAMBLE`) + export. Důvod: prompt-boundary dnes neexistuje a KB/memory jdou do system role neobalené (`orchestrationBridge` ř. ~874). Nelze nahradit `knowledgeIntegrity` (to je row-ranking, ne injection boundary).
- **Reuse:** obalení v `buildContextPromptSection`; runtime re-scan = existující `scanForInjection` + `aisha_resolve_clow_backend('rag.safety_scan')`; prahy z `system_config['ai_runtime']`.
- **DB:** žádná migrace. **Net-new komponenty:** 1 malý modul + 1 gate.

### 03 — Context budget + kompakce
- **Net-new (nutné):** `computeInputBudget()` čistá funkce (rozpočet dnes neexistuje). Kompakce = tenká glue funkce.
- **Reuse:** `ai_model_registry.context_window`/`max_output_tokens` (**už existují**) přes `modelDiscovery` (jen doplnit do `DerivedModelCaps` mapping); `estimateTokens()` (reuse); sumarizace přes existující `llmRouter` + `aisha_resolve_clow_backend` (žádná nová LLM cesta); prahy z `system_config['ai_runtime']`; nahradit hardcoded `.slice(-6)`.
- **DB:** žádná migrace (sloupce existují). **Net-new:** 1 pure fn + glue.

### 01 — Dynamický výběr toolů (v1 = intent routing)
- **Net-new (nutné, minimální):** `resolveToolSet()` — tenká funkce: `ALWAYS` set ∪ rodiny dle `analyzeChatQueryIntent` ∪ → filtr `canUseTool`. Žádné embeddingy.
- **Reuse:** `analyzeChatQueryIntent` (existuje), rodinné Sety (existují), `canUseTool` (existuje, gate po výběru), hook v `listToolsForUser`.
- **DB:** žádná. **Net-new:** 1 funkce + 1 parity/security gate.
- **Deferred v2 (jen při prokázaném nedostatku recall):** embedding tool-index (pgvector tabulka + RPC). Mimo nutné jádro.

### 05A — SSRF univerzální
- **Net-new (nutné):** gate `ssrf-no-bare-fetch` + přesměrování untrusted/web fetchů na existující `safeFetch`.
- **Reuse:** `createSsrfGuard`/`safeFetch` (existují); `SSRF_HOST_ALLOWLIST` (existuje v `config.ts`).
- **Deferred:** `createPinnedSsrfGuard` (undici) — hardening, ne nutné jádro.
- **DB:** žádná. **Net-new:** 1 gate (+ call-site úpravy, ne nové komponenty).

### 04+06 — Deep research + SearXNG (JEDINÁ net-new infra; opt-in)
- **Net-new (nutné, pokud chceme web research):** `WebSearchProvider`/`createSearxngProvider` (tenký adaptér) + `runDeepResearch` orchestrátor (tenký) + služba `searxng` (compose). Toto je jediné místo, kde je nová infra opodstatněná.
- **Reuse:** `criticLoop` jako sub-krok; `compose_context`/`ragnarok`; `llmRouter` + `aisha_resolve_clow_backend`; `safeFetch` (web fetch); `wrapUntrusted` (02); RAGAS `rag-eval-judges`; `tracer` budget; `system_config['ai_runtime']`.
- **Default off.** Bez rozhodnutí „chceme web research" se NEnasazuje (žádná zbytečná služba — capability gate v `services.json`).

---

## 3. Taxativní seznam net-new (vše ostatní zakázáno bez schválení)
1. `packages/security/src/untrusted.ts` (3 fn) — **02**.
2. `computeInputBudget()` + kompakce glue v svc-ai-chat — **03**.
3. `resolveToolSet()` (intent-based) — hook v **`chat.ts` allowed_tools** (NE `mcp.ts tools/list` — viz 09 §B-1) — **01**.
4. Gaty: `ssrf-no-bare-fetch`, prompt-boundary, tool-select parity — **05A/02/01**.
5. `system_config` řádek `ai_runtime` (data) + jeden `getAiRuntimeConfig()` loader (vzor `getRunnerCaps`) — **sdílené 02/03/01/04**.
6. **3 nové clow purposes** v `capability-resolver.ts` (data/config, ne komponenta): `chat.history_compaction` (03), `research.reasoning` + `research.extract` (04). Bez nich nejsou nové LLM cally governed/dynamické — viz 09 §C.
7. **(Opt-in)** SearXNG služba + `createSearxngProvider` + `runDeepResearch` — **04/06**.

Vše ostatní z 01–07 (migrace registry, tokenizer dep, embedding tool-index, pinned SSRF guard, nový admin panel jako povinnost) = **deferred / zrušeno**.

> **Bezpečnostní review (povinné guardrails, viz [09-final-review](09-final-review.md)):** 01 hook = `chat.ts` (ne mcp.ts); budget vynucovat jen při známém `context_window` (NULL → dnešní chování + backfill); hrubý token-count → nižší headroom (0.7) margin; `story-consult .slice(-6)` mimo scope; po obalení 02 spustit `decision-provenance` gate. Každý nový LLM call přes `aisha_resolve_clow_backend` s explicitním purpose (matice v 09 §C) — model vybírá AISHA za běhu, nic hardcoded.

---

## 4. Sdílené warm settings — jeden klíč, jeden loader, nula nových RPC
- **Klíč:** `system_config['ai_runtime']` (JSONB) — sdružuje prahy 02/03/01/04.
- **Čtení:** existující `get_system_config('ai_runtime')` + TTL cache (vzor `runtime-config.ts getRunnerCaps`).
- **Zápis (admin):** existující `set_system_config_admin(p_key:'ai_runtime', p_value, p_category:'ai_runtime', ...)` — audited, `is_admin_or_staff`, optimistic concurrency.
- **Administrace:** Appsmith (vzor `aitg-automation-control`) NEBO jen NocoDB nad `system_config`. Žádný nový RPC, žádná nová tabulka.
- **Fail-safe:** DB nedostupná → env default (jako `getRunnerCaps`).

---

## 5. Cross-check konzistence (ověřeno)
| Téma | Stav |
|------|------|
| Feature flagy fail-safe konvence (`!== 'false'` on / `=== 'true'` off) | konzistentní s `reflectionConfig`/`svc-agent-runner` |
| Warm prahy přes `get/set_system_config` | konzistentní s `agent_runner` vzorem |
| `context_window` zdroj | **jeden** — `ai_model_registry` (existuje); 01 i 03 z téhož; žádná duplikace |
| Token odhad | **jeden** — reuse `estimateTokens`; žádná nová dep |
| Tool routing | reuse `analyzeChatQueryIntent`; žádný druhý klasifikátor |
| Untrusted boundary vs ingestion scan | komplementární vrstvy (02 runtime + existující ingest); ne náhrada |
| SSRF | reuse `safeFetch`; gate vynutí univerzálně; pinning odloženo |
| Anon grants | nové grants (jen pokud 01 v2 tabulka) musí projít `security.gate` (anon žádné write) — konzistence s dokončeným auditem |
| Baseline/types řetězec | spouští se **jen** když vznikne DB objekt → v nutném jádru pouze u 01 v2 (odloženo) → v core **nespouští** |

---

## 6. Finální minimální task list (necessary core)
- [ ] `system_config['ai_runtime']` seed + `getAiRuntimeConfig()` loader (reuse get/set RPC + runtime-config vzor).
- [ ] **02:** `untrusted.ts` (3 fn) + export; obalit KB/memory v `buildContextPromptSection`; preamble; (volit.) re-scan reuse `scanForInjection`; prompt-boundary gate; flag `untrusted_wrapper_enabled`.
- [ ] **03:** doplnit `context_window`/`max_output_tokens` do `DerivedModelCaps` mappingu (čtení z registry); `computeInputBudget()`; kompakce glue (reuse `llmRouter`+resolver, `estimateTokens`); odstranit `.slice(-6)`; flag `adaptive_context_budget`.
- [ ] **01:** `resolveToolSet()` (ALWAYS ∪ intent→rodiny ∪ canUseTool) v `listToolsForUser`; parity+security gate; flag `dynamic_tool_selection`.
- [ ] **05A:** `ssrf-no-bare-fetch` gate; přesměrovat untrusted fetch na `safeFetch`; flag `ssrf_enforce`.
- [ ] **(Opt-in) 04+06:** rozhodnutí „web research ano/ne". Pokud ano: SearXNG služba + capability gate + cold-start probe + env-doctor klíč + `createSearxngProvider` + `runDeepResearch` (reuse criticLoop/compose_context/safeFetch/wrapUntrusted); flag `deep_research`.
- [ ] **Závěr (jen kde vznikl DB objekt — tj. nikde v core):** `db:init:generate`→`db:types:gen`→`security.gate`. Jinak: `test:gates` + `models-check` rozšíření o okno (čtení existujícího sloupce).

---

## 6b. Anthropic API capabilities (viz [10](10-anthropic-api-capabilities.md)) — reuse-first
Ověřeno: AISHA **už má** streaming + dynamicky governed **batch** (`batchSubmitter` + `aisha_choose_execution_strategy`) + provenance + registry s `cached_input_price_per_m`/`provider_metadata`. Doplnit (vše provider/model-aware, žádná nová komponenta):
1. **Prompt caching ZAPNOUT** v `anthropic.ts` (`system`+`tools` `cache_control: ephemeral`) + **stable-prefix pravidlo** v `orchestrationBridge` (stabilní: instrukce/pinned rulesets/tool schémata/`UNTRUSTED_POLICY_PREAMBLE` nahoře → breakpoint → variabilní: KB/historie/dotaz). **Nejvyšší cost ROI, malý zásah.**
2. **impl 01 provider-aware:** na Anthropic preferovat **cachovaný plný katalog** (nevariovat tooly → cache hit); dynamický výběr hlavně pro **lokální/non-caching** providery (vLLM/Qwen). Korekce: 01 je podmíněné providerem, ne univerzální.
3. **impl 03 provider-aware:** Anthropic → **native context editing**; ostatní → naše kompakce.
4. **Structured outputs:** upgrade existujícího `json_mode` → `output_config.format` u judges/safety/`research.extract`, gated `provider_metadata.structured_output` (Haiku 4.5 = beta; nekompatibilní s Citations).
5. **Batch:** nové offline workloady (RAG eval, embeddings, tool-index rebuild) směrovat přes `aisha_choose_execution_strategy` (reuse).
6. **Cost/capability governance:** `aisha_resolve_clow_backend` zohlední cached pricing + `provider_metadata` flagy. Data v registry, ne komponenta.

## 6c. Batch↔sync konzistence + test-first (viz [12](12-batch-consistency-and-test-plan.md))
- **Invariant:** Anthropic request body se staví VÝHRADNĚ přes nový sdílený `prepareAnthropicBody(request)` (mirror `openai-compat.prepareRequest`) — používaný sync `chat()`, novým `chatStream()` **i batch** (`BatchRequestItem.request`). Bez něj se sync a batch rozejdou při přidání caching/jsonMode/structured. Beta flagy přes `betas[]` z téhož builderu. Vynuceno gate A-1/A-3.
- **Caching stackuje s batchem** (−90 % z −50 %); cost tracking čte cacheReadTokens i z batch výsledků (`WF_BATCH_POLLER`).
- **Test-first / DoD předem:** každá položka má acceptance testy psané PŘED kódem (12 §B) — když jsou zelené, záměr je naplněn. Vzor: red (acceptance) → implementace → green → flag-off parity → gate. Gate konzistence batch/sync je **blokující** pro celý Anthropic parity balíček.

## 6d. Anthropic operating model (viz [13](13-anthropic-operating-model.md)) — respektujeme jádro, 3 malé doplňky
AISHA už respektuje jádro Anthropic frameworku: model governance (`aisha_resolve_clow_backend`, benchmark-scored per task_kind), augmented-LLM-first architektura, multi-provider (Path 1), `usage.output_tokens` billing, batch (`aisha_choose_execution_strategy`), self-managed stav (Messages API model, ne Claude session), PHI residency (`residencyCloudForbiddenMinSensitivity`). Dvě cesty: **přímé Messages API** (stateless, definované kroky) + **Claude Code v Dockeru** (one-shot agentic, autonomní úkoly). Nově doplnit (malé, governance):
1. **Extended thinking / effort** do `prepareAnthropicBody` (per purpose: reasoning→vyšší, classification→off).
2. **Eval-before-migration gate** — změna default modelu spustí eval set (reuse `ai_model_benchmarks`+RAGAS); bez green evalu se default nemění.
3. **Per-model prompt varianty** — system/few-shot laděné per model-family (Sonnet few-shot mate Opus); přepínané při eskalaci v resolveru.

## 6e. LangGraph umístění (viz [15](15-langgraph-placement.md)) — 80 % správně, 3 korekce
Reflection = home-grown DAG (`reflection/orchestrator.ts`); všechny LLM cally konvergují v `unifiedChat` (provider-vrstva změny tečou do všech nodes automaticky — caching/thinking/structured = **správně umístěno**); cost budget gate je na node boundary (**reuse, nestavět**). Tři korekce:
- **K1:** context editing/kompakce pro agenty (G2) patří na **orchestrator node boundary + `soulforge`** (kde `composed_context`/`state` rostou a netrimují se), NE chat history.
- **K2:** `prepareAnthropicBody` má **3. call site** — reflection `generator.ts` staví batch tělo inline; gate A-3 ho pokrývá.
- **K3:** tool selection je dvoukolejné — chat (`route_task` allowlist, impl 01) vs graf (per-node `node.config`, samostatný opt hook). Neslévat.
- **Caching↔soulforge tenze:** stabilní prefix držet mimo soulforge slot-variaci, jinak cache miss v grafu.

## 7. Co se NEdělá (explicitně mimo zadání)
- Žádná migrace `ai_model_registry` (sloupce existují).
- Žádný nový tokenizer/dependency (reuse `estimateTokens`).
- Žádný embedding tool-index v nutném jádru (intent routing stačí; v2 jen měřením podložené).
- Žádný pinned SSRF guard v nutném jádru (existující `safeFetch` + gate).
- Žádný nový settings RPC ani tabulka (reuse `system_config` + get/set).
- Žádná nová notifikační/vektorová infra (ChromaDB/ntfy — viz spec 06).
- Nový admin panel je volitelný (NocoDB stačí); není komponenta navíc.
