# Impl 14 — Zbývající gapy: analýza + zanesení do plánu

> 5 položek, které ještě nedotahujeme. Každá: **analýza (ověřeno v kódu) → effort/závislosti → dev considerations → testy předem (DoD) → pozice v plánu.** Vše reuse-first.

---

## G1 — Prompt caching (největší cost win)
**Analýza:** `anthropic.ts` posílá `system`/`tools` jako plain (žádný `cache_control`). Registry **už má** `cached_input_price_per_m` + `provider_metadata`. Vyžaduje: stable-prefix pořadí (orchestrationBridge), `cache_control` v `prepareAnthropicBody` (impl 12), cache pole v `ChatRequest`/`ChatResponse.usage`/`ModelUsage`.
**Effort:** S · **Závislosti:** `prepareAnthropicBody` (impl 12), stable-prefix (impl 10).
**Dev:** jen Anthropic-family; breakpoint za stabilním obsahem; cost čte `cache_read_input_tokens` (i z batche).
**Testy předem:** U `cache_control` na posledním stabilním bloku; C mock `usage.cache_read_input_tokens`→`cacheReadTokens`; G prompt-order (stabilní prefix); M cache-hit 2. request + −90 % v cost reportu. **Naplněno když:** 2. request cache_read>0, cost −90 %.
**Plán:** krok **4** (Anthropic parity balíček).

## G2 — Context editing / 200K guard pro agenty
**Analýza:** nevyužito; tool-heavy agenti (Dirigent/agent-runner, 40–80 tool callů) hrozí 200K fail. Anthropic native context editing (Anthropic-only) vs. naše provider-agnostická kompakce (impl 03).
> **UMÍSTĚNÍ (ověřeno, viz 15 §K1):** patří na **GRAPH-STATE — orchestrator node boundary** (kde `composed_context`+`checkpoint.state` rostou a nikdy se netrimují), vedle existujícího budget-gate (orchestrator.ts:305–346). **Reuse `soulforge.optimizePayload`** (existující node context shaper) rozšířený o cross-iteration kompakci. NE chat history. Cost budget gate tam už je — token/context compaction chybí.
**Effort:** M · **Závislosti:** impl 03 (kompakce pro non-Anthropic), `prepareAnthropicBody` (beta header), soulforge.
**Dev:** **provider-aware** — Anthropic → native context editing (clears old tool_results/thinking); ostatní → naše `computeInputBudget`+kompakce přes soulforge. Práh ve `system_config['ai_runtime']`. Cílit na orchestrator node boundary (reflection) + agent-runner. **Caching↔soulforge tenze** (15 §4): stabilní prefix držet mimo soulforge slot-variaci.
**Testy předem:** I agent s >threshold tool callů nepřeteče (Anthropic větev clears; non-Anthropic kompaktuje); U práh řízen `ai_runtime`; G žádný 200K fail na long-run fixture. **Naplněno když:** dlouhý agentní běh nespadne na context window u žádného provideru.
**Plán:** krok **6** (po 03 a parity balíčku).

## G3 — Extended thinking / effort (malý gap)
**Analýza:** `reasoningEffort?: "low"|"medium"|"high"` **už existuje** v `ChatRequest` (types.ts:57) + `UnifiedChatOptions` (llmRouter:104) + proplumbované (ř.432) — ale jen pro OpenAI o-series; **Anthropic ho ignoruje**. Gap = **mapping**, ne nové pole.
**Effort:** XS · **Závislosti:** `prepareAnthropicBody` (impl 12).
**Dev:** v builderu mapovat `reasoningEffort` → Anthropic `thinking: { type:'enabled', budget_tokens }` (low/med/high → budget tiery; volitelně „xhigh" = nejvyšší tier). Řízeno **per purpose/task_kind** (reasoning→high, classification→off). Billing už čte `output_tokens` správně (thinking se počítá tam). Pozor: thinking + structured/citations kombinace — ověřit kompatibilitu.
**Testy předem:** U `reasoningEffort='high'` → `thinking.budget_tokens` v Anthropic těle; U `undefined`/classification → bez thinking; C billing čte `output_tokens` (ne viditelný blok). **Naplněno když:** reasoning purposy běží s thinkingem, classification bez, cost správně.
**Plán:** součást **kroku 4** (parity balíček) — XS přílepek k builderu.

## G4 — Eval-before-migration gate
**Analýza:** harness **už existuje** — `benchmarkRunner.benchmarkModels` + `benchmarkScorer` + `benchmarkTaskSuite` → `ai_model_benchmarks` (overall_score per task_kind) přes `record_model_benchmark`. Chybí jen **gate**, který se spustí při změně default modelu.
**Effort:** S · **Závislosti:** žádné nové (reuse benchmark harness).
**Dev:** gate/flow: změna default modelu (registry / `ai_runtime`) → spustit `benchmarkModels` na novém modelu pro relevantní task_kind → **blokovat**, pokud `overall_score < práh` (nebo < incumbent − tolerance). Reuse `makeLlmJudge` + `ai_model_benchmarks`. Pozor: eval má cost/čas → spouštět při změně, ne na každém deploy; výsledek cachovat v `ai_model_benchmarks`.
**Testy předem:** U gate čte `ai_model_benchmarks` a porovná s prahem; I změna default na podřadný model (fixture) → gate **fail**; změna na ≥ incumbent → pass; C bez eval výsledku → gate fail (ne tiché povolení). **Naplněno když:** default model nelze změnit bez green evalu.
**Plán:** krok **2b** (spolu s warm config / governance — než se začnou měnit defaulty).

## G5 — Per-model prompt varianty
**Analýza:** prompty se staví v kódu (providers, workflowEngine, orchestrationBridge). V DB existuje vzor **`*_template_versions`** (verzování šablon — např. `consent_template_versions`). Anthropic insight: few-shot laděný na Sonnet mate Opus → potřeba varianta per model-family.
**Effort:** M · **Závislosti:** `aisha_resolve_clow_backend` (zná zvolený model/family).
**Dev:** **nestavět nový store** — reuse template-versioning vzor: prompt-varianta keyed `model_family` (anthropic-sonnet | anthropic-opus | openai | local). Resolver vrátí family → vybrat odpovídající system/few-shot variantu. Default = jedna varianta; varianty přidávat jen tam, kde se chování liší (few-shot heavy prompty). Začít minimálně: jen tam, kde eskalujeme Sonnet→Opus.
**Testy předem:** U resolver family → správná prompt varianta; C chybí varianta → fallback na default (ne fail); I (kvalitativní) Opus s Opus-variantou ≥ Opus se Sonnet-variantou na eval setu. **Naplněno když:** eskalace modelu nese odpovídající prompt; bez varianty se nic nerozbije (fallback).
**Plán:** krok **7** (po eval-gate; nasazovat postupně dle měřené potřeby).

---

## Zanesení do master plánu (aktualizace 00-impl-plan §Pořadí)
Nová konsolidovaná sekvence (XS/S napřed):

| Krok | Položka | Effort | Pozn. |
|------|---------|--------|-------|
| 1 | **01 wire `toolsAllowlist`** (chat.ts) | XS | AISHA už počítá allowlist |
| 2 | **Warm config `ai_runtime`** + **CLOW purposes** | XS | kopie patternů, 0 DB |
| 2b | **G4 eval-before-migration gate** | S | reuse benchmark harness; před měněním defaultů |
| 2c | **Anthropic principles → `expert_rules`** + conformance gate ([16](16-anthropic-principles-governed-kb.md)) | XS/S | governed KB přes Source Onboarding; reuse compose_context/CLAUDE.md overlay; každé pravidlo vázané na enforcement (G1/G3/G4/01/03/05A) |
| 3 | **03 enforce ContextBundle** budget + kompakce | S | data už tečou |
| 4 | **Anthropic parity balíček:** `prepareAnthropicBody` (12) + **G1 caching** + jsonMode/structured + streaming + **G3 thinking** | S | jeden balíček nad unified layerem; gate A-1/A-3 blokující |
| 5 | **02 untrusted wrapper** | S | jediná malá nová věc |
| 6 | **G2 context editing / 200K guard** (provider-aware) | M | po 03 + parity |
| 7 | **G5 per-model prompt varianty** | M | postupně dle měřené potřeby |
| 8 | **05A SSRF** gate + **batch směrování** offline workloadů | XS/S | bezpečnost + reuse |
| — | opt: 01 embeddings v2, citations | — | jen při měřené potřebě |

> Průřezově (impl 12 §B-0): vše za feature flagem + parity test; každý LLM call přes `aisha_resolve_clow_backend`; test-first (red acceptance → green → gate). Gate batch/sync konzistence (A-1/A-3) blokuje krok 4.

---

## Souhrn effortu
- **XS:** 01 wire, warm config+purposes, G3 thinking, batch směrování.
- **S:** G4 eval-gate, 03 enforce, parity balíček (+G1 caching), 02, SSRF.
- **M:** G2 context editing, G5 per-model prompty.
Žádná velká stavba; vše rozšíření/wire-up nad hotovým scaffoldingem.
