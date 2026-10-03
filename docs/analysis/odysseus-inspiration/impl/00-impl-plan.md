# Implementační plán — Odysseus inspirace (sváže impl 01–06)

> 🟢 **AUTORITATIVNÍ FINÁLNÍ ZADÁNÍ: [08-final-zadani.md](08-final-zadani.md)** — reuse-maximal, minimální net-new. Tam, kde se 01–07 liší, platí 08 (ověřeno proti kódu: žádná migrace registry, reuse `estimateTokens`/`analyzeChatQueryIntent`/`get-set_system_config`/`safeFetch`; embedding tool-index a pinned SSRF = deferred).
>
> 📋 **KONSOLIDOVANÁ SEKVENCE (vč. Anthropic capabilities + zbývajících gapů): [14-remaining-gaps-plan.md](14-remaining-gaps-plan.md) §Master plán** — 8 kroků XS→M, vše reuse-first. Doplňkové analýzy: [10](10-anthropic-api-capabilities.md) (caching/batch/structured/streaming), [11](11-stack-readiness.md) (readiness), [12](12-batch-consistency-and-test-plan.md) (sync↔batch + test-first), [13](13-anthropic-operating-model.md) (operating model).

> Implementačně připravené rozpady jednotlivých speců, ve vzájemném kontextu a v souladu se stackem (TS, Fastify, PostgREST, pgvector, `@aisha/security`, `embed-dispatcher`, `aisha_resolve_clow_backend`, `orchestrationBridge`).

## Pořadí a důvod
| Krok | Impl | Proč zde | Sdílené prerekvizity |
|------|------|----------|----------------------|
| 1 | [02 untrusted wrapper](02-untrusted-wrapper-impl.md) | nejnižší effort, nejvyšší bezpečnostní páka, aditivní | `orchestrationBridge` (sdílí s 03) |
| 2 | [03 context budget/kompakce](03-context-budget-impl.md) | odblokuje dlouhé konverzace + malé modely | `ai_model_registry.context_window` (sdílí s 01), `orchestrationBridge` (s 02) |
| 3 | [01 dynamický výběr toolů](01-dynamic-tool-selection-impl.md) | řeší context-bloat 27 MCP toolů | `context_window` (z 03), `embed-dispatcher` |
| 4 | [05A SSRF univerzální](05A-ssrf-universal-impl.md) | rychlý security win, prerekvizit web fetchů | `@aisha/security/ssrf` |
| 5 | [04+06 deep research + SearXNG](04-06-deep-research-searxng-impl.md) | staví na všem výše | 01 (zdroje), 02 (wrapper), 03 (budget), 05A (pinned SSRF) |

> **Dopady & integrace napříč** (settings/administrace, cold-start, doctor, gates, types, observability): viz [07 impact & integration](07-impact-and-integration.md) — blast radius každého impl + settings matrix (cold/warm/hot + admin surfacing).

## Sdílené prerekvizity (udělat jednou, neduplikovat)
1. **`ai_model_registry.context_window` + `max_output_tokens`** — migrace přes SoT → `db:init:generate`. Konzumuje **03** (budget) i **01** (dynamické K). Udělat v jedné migraci.
2. **`orchestrationBridge` PR vlna** — **02** (obalení KB/memory) i **03** (budget/kompakce) sahají do téhož modulu → koordinovat, ať se nebijí o tutéž funkci.
3. **`@aisha/security`** — **02** přidává `untrusted.ts`, **05A** rozšiřuje `ssrf.ts`. Stejný balík, společný build/release.
4. **`aisha_resolve_clow_backend`** — sjednocený LLM/back-end resolver: kompakce (03), safety re-scan (02), decompose/extract/synthesize (04). Žádné nové LLM cesty.

## Průřezové principy (cíl: vše dynamické)
- Konstanty → runtime rozhodnutí napojené na existující infra (ne nový paralelní systém).
- Bezpečnost deklarativně na každém boundary (untrusted wrapper 02, SSRF gate 05A), ne ad-hoc per call-site.
- Každá změna za **feature flag** s parity-fallbackem na dnešní chování.
- Každý impl má vlastní **task checklist** + **testy** (unit + gate; integrace přes throwaway DB / mock LLM).

## Definition of Done (napříč)
- [ ] Feature flag + flag-off parity test.
- [ ] Unit + gate testy zelené (`vitest --config vitest.gates.config.ts`).
- [ ] Žádná regrese `security.gate` (anon grants, PHI, SSRF).
- [ ] SoT změny → `db:init:generate` (baseline nikdy ručně) + cold-start verify v CI.
- [ ] Langfuse telemetrie tam, kde se ladí prahy (tool selection, research budget).

## Mapování na stack (kam co)
- `packages/security/` → `untrusted.ts` (02), `ssrf.ts` pinned (05A)
- `services/svc-ai-chat/src/lib/` → `contextBudget.ts`, `contextCompactor.ts`, `tokenCount.ts` (03), `runDeepResearch` (04), úpravy `orchestrationBridge.ts` (02/03)
- `services/svc-mcp-knowledge/src/` → `resolveToolSet.ts` + `mcp.ts` hook (01), `webSearch.ts`/`svc-web-search` (06)
- `aisha/db/sql/` → `ai_model_registry` (+okno, 01/03), `agent_tool_embeddings` + `match_agent_tools` RPC (01)
- `docker-compose.coolify-*` + `config/searxng/` → SearXNG (06)
- `src/tests/gates/` → `ssrf-no-bare-fetch` (05A) + prompt-boundary gate (02)
