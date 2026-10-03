# Impl 17 — Stav implementace vlny 1 (post-merge audit)

> Ověřeno proti kódu po merge PR #566 (anon grants) a PR #567 (odysseus core wave 1)
> + follow-up healů. Tento dokument je SoT pro „co už platí" — při čtení impl/00–16
> má přednost tam, kde se liší (starší dokumenty popisují stav PŘED vlnou).

---

## 1. Co je NAMERGOVANÉ v main (vlna 1)

| Krok (impl/14) | Stav | Kde žije | Testy/gaty |
|---|---|---|---|
| 0 — anon grants SELECT-only floor | ✅ PR #566 + heal 27c3dc4e (existing DBs) | `scripts/db/scope-anon-grants-select-only.mjs`, grants SoT, baseline | `anon-grants-select-only.gate` (4) |
| 1 — wire `toolsAllowlist` | ✅ | `svc-ai-chat/src/lib/toolSelection.ts` + `routes/chat.ts` (před `loadToolsByNames`) | `tool-select-parity.gate` (4) + 12 U |
| 2 — warm config + purposes | ✅ | `aiRuntimeConfig.ts` (TTL loader), seed `07_system_config.sql['ai_runtime']`, `capability-resolver.ts` (+`chat.history_compaction`, `research.reasoning`, `research.extract`) | 10 U + 4 U resolver |
| 2b — G4 eval-before-migration | ✅ | `set_active_ai_model_admin.sql` (fail-closed, práh `ai_runtime.eval_min_overall_score`=0.6) + heal 41e6fed5 | pgTAP `18_…` (9) + `eval-before-model-migration.gate` (4) |
| 2c — principles → expert_rules | ✅ | seed `38_anthropic_operating_principles.sql` (6 pravidel, Source-Onboarding klasifikace v tazích) | `anthropic-principles-conformance.gate` (9) |
| 3 — context budget + kompakce | ✅ (flag `ADAPTIVE_CONTEXT_BUDGET`, default OFF) | `contextBudget.ts`, `contextCompactor.ts`, `chat.ts`, `get_adaptive_model_tiers` (+`windows`) | `context-budget-parity.gate` (5) + pgTAP `19_…` (5) + 21 U |
| 4 — Anthropic parity balíček | ✅ | `packages/llm-dispatch/providers/anthropic.ts` — `prepareAnthropicBody` (jediný builder sync/stream/batch), caching, thinking, jsonMode, nativní SSE | `anthropic-body-builder.gate` (6) + 14 U |
| 5 — untrusted wrapper | ✅ bridge / ⚠️ generator → **fix `feat/reflection-generator-untrusted-fence` (PR #574)** | `packages/security/src/untrusted.ts` (0.2.0), `orchestrationBridge.buildContextPromptSection` | `prompt-boundary.gate` (9→12 po K2 fixu) + 6 U |

**Celkem po vlně:** 7 nových gatů, 2 pgTAP schema testy, ~63 unit testů, 2 seed soubory, 3 SQL funkce (SoT + baseline regen).

## 2. Korekce cest (upstream refactor během návrhu)

Dokumenty impl/01–16 odkazují na `services/svc-ai-chat/src/lib/providers/*` —
**provider vrstva se mezitím extrahovala do `packages/llm-dispatch`** (PR #563,
`@aisha/llm-dispatch`). Platné cesty:

| V dokumentech | Skutečnost |
|---|---|
| `svc-ai-chat/src/lib/providers/anthropic.ts` | `packages/llm-dispatch/src/providers/anthropic.ts` |
| `svc-ai-chat/src/lib/llm/types.ts` (ChatRequest/Response) | `packages/llm-dispatch/src/providers/types.ts` |
| `reflection/generator.ts:97–181` (K2 batch tělo) | `reflection/nodes/generator.ts` (~ř. 105–130) |
| `estimateTokens` sdílený | `svc-ai-chat/src/lib/contextBudget.ts` (chat vrstva; mcp-knowledge má lokální) |

## 3. Provozní learnings (z healů po vlně)

- **SoT změna funkce ≠ existující DB**: cold-start bere baseline, ale běžící DB
  potřebují heal (`heals.sql`) — viz 27c3dc4e (anon grants floor) a 41e6fed5
  (governed fns + compiled seed regen). Pravidlo: každá změna SQL funkce ve
  vlně → zvážit heal pro live instance.
- **`updated_at` parity** (6183d692): tabulky dotčené novými RPC musí mít
  trigger/sloupec parity — 5 tabulek bylo un-UPDATEable.
- **Baseline merge konflikty**: řešit VŽDY regenerací z merged SoT
  (`db:init:generate`), nikdy ruční editací (4d862ed2, fa8949e1).

## 4. Zbývá (vlna 2 — dle impl/14 pořadí)

| Položka | Effort | Poznámka |
|---|---|---|
| **K2 generator fencing** | XS | ✅ hotovo na `feat/reflection-generator-untrusted-fence` (PR #574; fix + rozšířený gate) — zbývá merge |
| Stable-prefix wiring v chat cestě | S | `ChatRequest.systemPromptStable` je v balíčku; chat/judges callery ho zatím nepředávají → cache hit zatím jen na tools + celo-systémových callerech |
| Cost accrual čte `cacheReadTokens` | S | pole teče v `ChatResponse.usage` (sync i batch); costAggregator/spendEstimate zatím účtují plnou sazbu — napojit `cached_input_price_per_m` |
| 6 — G2 context editing / 200K guard (agenti) | M | orchestrator node boundary + soulforge (impl/15 K1); Anthropic native context editing za `CAPABILITY_BETAS` |
| 7 — G5 per-model prompt varianty | M | template-versioning vzor; až po měřené potřebě |
| 8 — 05A `ssrf-no-bare-fetch` vitest gate | XS/S | semgrep pravidlo existuje (`aisha-raw-fetch-outside-ssrf-guard`); chybí vitest gate + úklid call-sites |
| 8 — batch směrování offline workloadů | S | RAG eval / embeddings / tool-index přes `aisha_choose_execution_strategy` |
| 04+06 — deep research + SearXNG | M (opt-in) | default off; rozhodnutí „chceme web research" před stavbou |
| Conformance eval suite (impl/16 §4.1) | S | statický gate běží; behavioral scénáře přes benchmark harness chybí |

## 5. Flag přehled (runtime stav vlny)

| Flag | Default | Význam |
|---|---|---|
| `DYNAMIC_TOOL_SELECTION` | off (`==='true'` zapíná) | route-plan narrowing toolů |
| `ADAPTIVE_CONTEXT_BUDGET` | off (`==='true'` zapíná) | budget + kompakce (zapnout po backfillu `context_window`) |
| `UNTRUSTED_WRAPPER_ENABLED` | **on** (`==='false'` vypíná) | prompt-boundary fence KB/memory/learnings |
| `system_config['ai_runtime']` | seed 0.7/0.85/6/1024/0.6… | warm prahy, admin edit bez redeploye |
