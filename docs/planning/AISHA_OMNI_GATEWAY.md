# AISHA Omni — OpenAI/Anthropic-kompatibilní fasáda + supervizní páteř

**Zadání pro implementaci** · rozšíření `evymo-ai-orchestrator` (`aisha-orchestrator`)
**Typ:** rozšíření existujícího stacku — NE greenfield mikroservis
**Stav:** návrh **v6** (rebase na `origin/main` #458; finální mechanism-grounded implementační plán — viz §22; 8 painted-over gapů identifikováno proti reálnému kódu)

## 0.1 Vztah k oficiálnímu ZADÁNÍ (SoT)

Tento dokument **rozšiřuje** `docs/proposals/AISHA_ORCHESTRATION_ZADANI.md` (orchestrační autorita), neduplikuje ho. Omni = **IDE-gateway povrch** nad Epochami **E0 (✅ merged PR#442) + E1 (wire-up) + E3 (runtime adaptéry) + E4 (adaptive + centrální feedback plane, Q5) + E5 (transparentnost)**; samotná `/v1` fasáda + streaming + PAT jsou genuinely-new „**E-Omni / gateway epoch**" nad nimi. Odkazy na admission / decision journal / clow / resolver / risk policy jsou **SoT-pointing**, ne re-specifikace:
- **Admission** = merged `fn_admit_clow` (`baseline.sql:31002+`, pre-resolver, 4 osy spend/runtime/capability/risk; ZADÁNÍ §6.1, invariant I6). Omni `/v1` ho MUSÍ volat před `engine.execute()` — dnes nevolá (§9 mezera; admission je zapojen jen v reflection nodes, `openclaw_resolve_clow.ts`).
- **Decision journal** = merged `ai_decisions` (`baseline.sql:1946+`) + jediný writer `fn_record_execution_decision` (`baseline.sql:30429`) + helper `dispatchDecision()` (`reflection/decision.ts`); invariant I1/I3 „no dispatch without journaled decision". Omni vlákno: `decision_id` na `ai_trace_events` + hlavička `X-AISHA-Decision-ID`.
- **Capability tiers** (§5.5 `aisha-fast/…/onprem`) = přímý konzument ZADÁNÍ §2.4 „capability-availability infrastructure" (Q4): tier = runtime × backend_kind × provider; chybí-li capability → **admission deny**, ne tichý fallback.
- **Centrální feedback plane** (Omni §4.4) = gateway-facing konec ZADÁNÍ §6.4 (Q5, povinná infra).
- **Resolver** = `aisha_resolve_clow_backend` (`baseline.sql:17685`, ZADÁNÍ §7.2) — Omni jen předá `clow`.
- **Pozn.:** data-residency gate (§11, `detectDataSensitivity`) je **ortogonální** k `fn_admit_clow` (ten neklasifikuje citlivost) → zůstává Phase-A scope Omni.

---

## 0. Účel, princip, legenda

**Cíl:** zpřístupnit existující složený AI systém AISHA (orchestrátor „Dirigent", model-cascade, sandbox/self-heal, Langfuse, realtime fabric, supervize lokálních agentů) navenek jako **malou rodinu virtuálních modelů** přes OpenAI/Anthropic-kompatibilní API — zapojitelnou do Cursor/Cline/Continue/Zed/Claude Code — a zajistit, že stejná páteř doručuje **správnou a včasnou zpětnou vazbu lokálnímu Dirigentovi** na stroji vývojáře.

**Princip:** nestavíme nový mozek. Píšeme **tenkou fasádu + jednu událostní páteř** nad ~80 % existující logiky. Review potvrdil, že substrát je reálný a nosný; nové je: tokenový streaming, OpenAI/Anthropic plocha, broadcast triggery, governance gate, okamžitý push korekcí.

**Legenda:** 🟢 [REUSE] beze změny · 🟡 [EXTEND] drobně rozšířit · 🔵 [NEW] nový kód · 🔴 [BLOCKER] před Fází A

---

## 0.5 Co Omni JE / NENÍ (produktový kontrakt)

> **„AISHA Omni není model — je to tvůj delegovaný orchestrační backend v OpenAI/Anthropic kabátě: jednoduché turny streamují jako každé LLM, složité se stávají supervizovanými, governovanými, nákladově měřenými běhy, které *pozoruješ*, ne řídíš — a stejný klíč funguje v každém IDE."**

- **NENÍ** plochý model — je to **rodina tierů** s předvídatelnou cost/latency obálkou.
- **NENÍ** passthrough — drží otěže (resolver, admission, quality floor, audit).
- **NENÍ** OpenAI-streaming-kompatibilní pro orchestrované (tier 3+) dotazy — ty jsou async (202 + poll/WS).

Koherence je **podmíněná** třemi věcmi povýšenými na kontrakt: (1) complexity-routing je POVINNÝ; (2) nesmí se prodávat jako „model" před zapojením governoru (E3/E4 + push C); (3) tři povrchy jsou jeden produkt jen s rozhodovacím stromem podle `Authorization`.

---

## 0.6 Implementace veřejné hrany + naming (SoT, 2026-07-06)

**Veřejný host = `ask.<public_tld>/v1`** (např. `ask.aisha.guru/v1`) — dedikovaná značková doména „ask AISHA" (§2 „distinct host, ne gateway"). IDE nastaví `ANTHROPIC_BASE_URL=https://ask.aisha.guru/v1`, klíč = PAT (`Bearer mcp_<token>`, ražený `create_mcp_token` KC-přihlášenému uživateli; validace `validate_mcp_token`).

**Mechanismus = „Pattern 2" (přes core gateway, NE vlastní router na svc-ai-chat).** Řetěz:
```
IDE → ask.<tld> (edge Caddy slot, TLS termin. na pfSense/HAProxy — wildcard *.<public_tld>)
     → core gateway @aisha/gateway (api.<internal_tld> face, už má router+cert)
     → STREAMING /v1 proxy (services/gateway/src/routes/v1.ts, @fastify/http-proxy — NIKDY functions.ts arrayBuffer)
     → svc-ai-chat:3011/v1/*  (interní služba, ŽÁDNÝ public router / LE cert)
```
`svc-ai-chat` je **čistě interní** — dosažitelný jen přes shared network (`svc-ai-chat:3011`), stejně jako `/functions/v1/ai-chat`. Resolver: `GATEWAY_DOMAIN_PUBLIC=ask.<tld>`, `GATEWAY_UPSTREAM_PUBLIC=<api core face>`. Zamčeno gatem `omni-model-gateway-face.gate.test.ts`. *(Toto opravuje PR #613, který chybně dal interní službě vlastní `certresolver=letsencrypt` router — public TLS se ale terminuje výš, ne na kontejneru.)*

**Naming — POZOR na past:**
| Pojem | Co to reálně je | Umístění |
|---|---|---|
| **„router" / mozek AISHy** | `aisha_resolve_clow_backend` (RPC) + `llmRouter.ts` — vybírá backend/model per-task | uvnitř `svc-ai-chat` → **= AISHA model, veřejně `ask.<tld>/v1`** |
| **`llm-gateway`** (kontejner) | **connector/driver na llmgw.io** (self-hosted `theopenco/llmgateway`) — poskytuje další modely dle potřeb AISHy | interní backend, `public:false`; router ho volí přes `backend_kind='llm_gateway'` (role 2) + `/v1/batches` (role 3) |

Kontejner `llm-gateway` **NENÍ** router — je to jeden z driverů, na které router (v svc-ai-chat) dispatchne. Rename kontejneru je kosmetický follow-up; env var `GATEWAY_*` (edge „extra public face" slot, teď nese `ask`) taky.

---

## 1. Ověřený ledger (po review — opraveno)

| # | Závislost | Verdikt | Důkaz / oprava |
|---|---|---|---|
| 1 | Orchestrátor + spuštění běhu | 🟢 potvrzeno | `reflect.ts:33` `POST /reflect/runs` (202, service-role); `orchestrator.ts:139` in-process smyčka s checkpointem |
| 2 | message→clow→run | 🟢 potvrzeno, **opraveno** | klasifikace `orchestrationBridge.classifyMessageComplexity():1034` (volá se :1219); `kickOffReflectionWorkflow:1342` zakládá `ai_runs` (`fn_create_workflow_run:1350`) + `runWorkflow:1383`; `chooseExecutionStrategy:1308`. **`kickOffReflectionWorkflow` i `chooseExecutionStrategy` zatím NEMAJÍ volajícího — /v1 ingress je musí zapojit.** (NE „:1384") |
| 3 | Model cascade | 🟢 potvrzeno | `classifyMessageComplexity` 5 tierů + `getLocalModelTiers/getCloudModelTiers/getFallbackModelTiers:1096-1148` |
| 4 | Resolver local-vs-cloud | 🟢 **živé** | `aisha_resolve_clow_backend` v **`aisha/db/migrations/00000000000000_baseline.sql:17681`** (autoritativní); archivní kopie jen historická |
| 5 | LLM volání bufferované | 🟢 potvrzeno | `llmRouter.ts:342` `unifiedChat → Promise`; `openai-compat.ts:273,287` `fetch`+`await .json()`; `executeWithFallback:384` retry po celé odpovědi |
| 6 | Autoritativní router | 🟢 potvrzeno, **opraveno** | `llmRouter.ts` (generator.ts:2). **`llm-router.ts` NENÍ mrtvý dup — je to živý LEGACY router (378 ř.) aktivně importovaný `routes/evaluate.ts` + `routes/story-consult.ts`, nekompatibilní návratový typ → konsolidovat PŘED streamem** |
| 7 | Telemetrie | 🟢 potvrzeno | `tracer.ts` → `/api/public/ingestion`; `ai_trace_events`; `react_thought` event |
| 8 | Realtime fabric | 🟢 potvrzeno | `event-worker` (PG `LISTEN`→`redis.publish`) + `ws-gateway`; konzumer už umí `realtime_broadcast`+`channel_topic`→`ws:broadcast:<topic>` |
| 9 | Broadcast producent | 🔴 **chybí, opraveno** | žádný `pg_notify('realtime_broadcast')`; **cílové tabulky nemají ŽÁDNÝ trigger ani sloupec `updated_at` (jen `created_at`)** → nutná migrace |
| 10 | Supervizní smyčka | 🟢 **živé** | `dirigent-supervisor.ts /dirigent/dispatch` (sync `decision`, 8s/4s budget); `dirigent_nudges` (producent `ai_spend_governance`); `story_goal_state`; 5 consult RPC; `fn_detect_agent_runaway` watchdog. **Ověřeno: konsolidováno v živé baseline (commit fe939cf1) — archive-liveness uzavřeno** |
| 11 | Push korekcí na stroj | 🔴 **mezera, opraveno** | nudges = pull; **3 schémata bez `nudge`/`decision`: `bridge.ts` ServerMessageSchema, `aisha-push.ts` AishaPushEvent, `workbench-core ISseClient`** |
| 12 | Edge proxy pro `/v1` | ⚠️ **pozor** | `functions.ts:193,248` BUFFERUJE (`arrayBuffer`) → `/v1` musí být streamovací proxy (`@fastify/http-proxy` / pipe `upstreamRes.body`), NIKDY tento vzor |
| 13 | PAT pro IDE | 🟡 **kotva + opraveno** | `mcp_auth_tokens` (15 sloupců) + `create_mcp_token`/`validate_mcp_token` existují; **prefix `mcp_` (ne `sk-aisha-`); klíčuje na account_id/project_id/created_by — chybí `user_id` FK + `scope text[]`** |
| 14 | Kvóta | 🟡 **opraveno** | `fn_check_and_consume_llm_quota_audited` se volá nepřímo přes `fn_check_and_consume_ai_budget_audited` na node-boundary (post-cost) v orchestrator.ts. **Pravá mezera: žádný PRE-dispatch gate v chat.ts/v1** |
| 15 | Governance residency | 🔴 chybí | `governedOrchestration.ts` = risk/approval, ne data-residency; citlivé tabulky `member_health_documents`/`dosing_logs`/`longevity_scores` + RLS; `clow.allow_local` existuje |

---

## 2. Architektura — jedna páteř, tři povrchy

```
                          ┌──────── ZDROJ PRAVDY (DB) ────────┐
  reflection/orchestrator · aisha_resolve_clow_backend · governance · goal_evaluator
                          └─ ai_trace_events · dirigent_nudges · story_goal_state · ai_runs ─┘
                                          │ NOTIFY realtime_broadcast (🔵 generická factory)
                                          ▼ event-worker → Redis → ws:broadcast:<topic>
        ┌─────────────────────────────────┼───────────────────────────────────┐
        ▼ TOKEN lane (in-process)          ▼ STAV lane (topic run:<id>)         ▼ FEEDBACK (workspace:<id>)
   unifiedChatStream → SSE delta      „viditelné myšlení"                  ws-gateway → ide-bridge → lokální Dirigent
        │  (autoritativní pro OBSAH)       │ (lag/drop OK)                      + sync /dirigent/dispatch (≤4 s)
        └──────────► Cursor/Cline/Zed/Claude Code ◄─── rodina aisha-* modelů, OpenAI + Anthropic protokol
```

**Tři povrchy = JEDEN produkt, klíč = `Authorization`:**
- `Bearer mcp_…`/`sk-aisha-…` (PAT) → **Omni `/v1`** — orchestrovaná, governovaná, měřená, streamovaná produkční cesta.
- `Bearer sk-…`/vlastní provider klíč → **llm-passthrough** (theopenco; dev-only, neměřené, governance-bypass, zakázané pro produkční Dirigent práci).
- bez `/v1`, `/functions/v1/*` → **API edge** (`@aisha/gateway`; interní routing, buffering OK).

**Akce:** v dokumentaci přestat všemu říkat „gateway" (edge-proxy / llm-passthrough / Omni); přidat `GET /.well-known/aisha-gateways` discovery; vyřešit kolizi `/v1` distinct hosty (`omni.…/v1` vs `llm-gateway.…/v1`); `/v1/models` na Omni inzeruje rodinu `aisha-*`, passthrough inzeruje raw provider modely (různé seznamy záměrně).

---

## 3. Komponenty a umístění

- **Mozek = `svc-ai-chat`** 🔵 — orchestrátor/router/tracer in-process; `/v1` logika (`v1-chat.ts`) sem.
- **Veřejná hrana = `@aisha/gateway`** 🟡 — streamovací `/v1/*` proxy (`v1.ts`). **NIKDY** vzor `functions.ts` (bufferuje).
- **`svc-omni`** = jen logická role, ne nový kontejner (pokud load test neukáže opak — viz níže).
- **NE theopenco passthrough** jako orchestrátorský front (záměrně bez routing logiky).

> 🔴 **Pre-Phase-A gate:** in-process co-umístění (token streaming + SSE projekce + synchronní orchestrátor na jednom event-loopu `svc-ai-chat:3011`) je **sporné rozhodnutí**. Před commitnutím Fáze A: **load test** (10 souběžných IDE SSE + n8n batch + reflection) → měřit event-loop lag + SSE jitter. Když OK → in-process (max reuse). Když ne → tenký standalone `svc-omni` projektor za `@aisha/gateway`. Rozhodnout empiricky, je to drahé reverzovat.

---

## 4. Datové toky

### 4.1 Ingress → clow → run 🟡
1. 🔵 Validace OpenAI/Anthropic těla; `temperature`/`top_p`/`max_tokens`/`tools[]` přijmout a ignorovat (nikdy 4xx na extra param).
2. 🔵 **Eager resolver na ingressu** — zavolat resolver hned, ať se lane (rychlá vs orchestrace) a backend rozhodnou *společně* (jinak klasifikátor řekne „simple" a zaváže rychlou lane, ale resolver by pro běh vybral cloud → rozpor).
3. 🟢 Pro běh: `kickOffReflectionWorkflow` (zapojit!) zakládá `ai_runs` → `POST /reflect/runs`.

### 4.2 Token lane 🔵 + 4.3 Stav lane 🟢🔵
- Token: in-process `unifiedChatStream` → `delta.content`. **Žádný DB/Redis hop.**
- Stav: trigger `realtime_broadcast` (topic `run:<id>`) → Redis SUB projektor → SSE chunky (`react_thought`→myšlení, `tool_call`/`test_run`→testuji, retry→opravuji, `route_decision`→volím model).

> 🔵 **Consistency contract (povinné, §4.2/4.3):** *Tokenový proud je autoritativní pro OBSAH; `run_id`+checkpoint je autoritativní pro STAV. Stavové eventy mohou zpozdit/vypadnout (fire-and-forget). Klient NIKDY neodvozuje dokončení běhu jen z tokenů.* Bez toho hrozí split-brain (svc-ai-chat spadne mezi tokenem a triggerem → klient má text, Dirigent neví o dokončení).

### 4.4 Feedback lokálu 🟢 + 🔵
- 🟢 Sync gating `/dirigent/dispatch` (`decision allow|block|ask`, ≤4 s); 5 consult RPC; watchdog.
- 🔵 Okamžitý push: nudge trigger → `realtime_broadcast` (`workspace:<id>`/`session:<id>`) → `ws-gateway` → lokální Dirigent dostane korekci mid-run (re-fetch kontextu jen když nudge překročí RLS hranici). **Korekce (po ověření):** `AishaPushEvent` je **duplicitní ve 2 místech** (`aisha-push.ts` + `workbench-core/ISseClient`) → sjednotit do jednoho SoT (`workbench-core/src/sse/schemas.ts`); `bridge.ts ServerMessageSchema` je **samostatný** IDE-instrukční protokol (`ready/context_changed/pong`), NE třetí kopie. Všechna tři ale dnes postrádají `nudge`/`decision` → rozšířit (2 duplikáty přes sjednocený typ).

### 4.6 Statefulness kontrakt 🔵
- `/v1` je **stateful-optional**. Absentní `conversation_id` → `chat.ts:412-429` auto-vytvoří nový → stateless IDE plodí duplicitní konverzace. → odvodit session z PAT `user_id`+namespace; **echo `conversation_id` v každém chunku + final done**; pass `conversation_id` k resume. Test matrix: stateless / stateful multi-turn / complex-turn `ai_runs` chaining.

---

## 5. Rozhraní (OpenAI + Anthropic) 🔵

**Inbound:** `POST /v1/chat/completions` (OpenAI) + `POST /v1/messages` (Anthropic — Claude Code/Cursor agent mode jedou přes `ANTHROPIC_BASE_URL`; oba funnelují do `unifiedChatStream`, routing zůstává uvnitř běhu). `GET /v1/models`.

**Chunk:** `data: {"id":"chatcmpl-aisha-<runid>","object":"chat.completion.chunk","created":<unix>,"model":"<požadovaný-tier>","choices":[{"index":0,"delta":{"content":"…"},"finish_reason":null}]}` → poslední `finish_reason:"stop"` → `data: [DONE]`.

### 5.5 Identita modelu & discovery 🔵
- **Rodina explicitních tierů:** `aisha-fast`, `aisha-balanced`, `aisha-deep`, `aisha-reasoning`, `aisha-onprem` — `model` → 1:1 cost/latency. (`aisha-orchestrator` jen jako auto-routing convenience.) Jedno opaque id = stejný vstup stojí 100× bez signálu klientovi.
- `model` v odpovědi echuje **požadovaný tier**, nikdy tichý fallback backend; resolved backend přes `X-Resolved-Backend` debug header.
- `/v1/models` na Omni inzeruje rodinu + cost-range metadata.

### 5.6 Mapování chyb / terminálních stavů 🔵
- **Synchronní gaty jako HTTP PŘED SSE:** 402 `spend_denied`, 403 `governance_not_allowed`, 202 `pending_approval`+`approval_url`, 202 `deferred_batch`+`polling_url`.
- **NErozšiřovat `finish_reason` enum** (rozbije SDK). Mid-stream policy block → `finish_reason:"content_filter"` + strukturovaný error chunk.
- Vždy nést `run_id` v `X-AISHA-Run-ID` pro recovery.

---

## 6. Model cascade 🟢 REUSE + 6.5 povinný routing

🟢 Fasáda jen předá `clow` — `classifyMessageComplexity` + tier mapy + `aisha_resolve_clow_backend` (`allow_local` boost) + `llmRouter` fallback/circuit-breaker. **Nereimplementovat** (jediný zdroj pravdy).

> **Kde sídlí rozhodování (důležité — routery NEjsou mozek):** „co se zvolí a jak se rozhazují úkoly" NEsídlí v žádném routeru, ale v **DB + orchestrationBridge** vrstvě:
> - `route_task.sql` (RPC) — agent pipeline + tools + gates + risk override = **„jak se rozhazují úkoly"** (volá `routeViaAisha` orchestrationBridge:445);
> - `aisha_resolve_clow_backend.sql` — per-clow skórování backendu;
> - `aisha_choose_execution_strategy` / `get_adaptive_model_tiers` — sync vs async, tiery;
> - `orchestrationBridge.classifyMessageComplexity`(:1034)→`selectOptimalModel`(:1212), `chooseExecutionStrategy`(:1308).
>
> **Oba routery jsou jen EXEKUTOŘI** zvoleného: `llmRouter.ts` (camel) = registry + fallback + circuit-breaker + `deriveStoreAtProvider` policy (používá generate/reflection/workflowEngine/criticLoop/proactiveEngine); `llm-router.ts` (kebab) = tenký direct-dispatch bez fallbacku (jen `evaluate.ts` + `story-consult.ts`). Žádná **rozhodovací** logika není exkluzivní pro kebab.

### 6.5 Mandatory complexity-routing jako kontrakt 🔴
- tier 1/2 → **pravé SSE**, garance prvního tokenu **<500 ms** (`unifiedChatStream`).
- tier 3+ → **NESTREAMOVAT** přes spojení; vrátit **202 + `X-Stream-Poll-URL`** (`/reflect/runs/{id}`) / WebSocket `/realtime/v1`. (Orchestrované běhy 1–20 min negenerují tokeny během deliberace → idle timeouty Claude Code ~30 s / Cursor ~60 s / Continue ~120 s.)
- Instrumentace: time-to-first-token p50/p95/p99 (alert p95>10 s) pro stream tiery; time-to-202 pro orchestrované.

---

## 7. Streaming engine 🔵 NEW core (invertováno)

**Pre-step (🔴 PŘED streamem) — konsolidace exekutorů, NE „mozku":** je to cleanup duplicity, mění **nula** routing rozhodnutí (mozek = DB+orchestrationBridge, viz §6 — netknutý). `deletion_safe=false` jako drop-in; úkol je **„migrovat 2 importery, PAK smazat"** s akceptačními podmínkami:
> 1. **Signatura:** `evaluate.ts`(:71,:119) + `story-consult.ts`(:262,:285) volají `unifiedChat({model})` bez `provider`; camel `provider` VYŽADUJE → obalit `provider: resolveProvider(model)`.
> 2. **Návratový tvar (load-bearing):** kebab flat `{text,inputTokens,outputTokens}` → camel `{text,usage:{…}}`; přepsat čtení (`evaluate.ts:101`, `story-consult.ts:346-376`) na `result.usage.*`.
> 3. **Parita providerů + Maestro:** kebab mapuje `local-/llama/qwen` (case-sensitive) vs camel `docker-/ollama-/vllm-/gateway:` (case-insensitive) — ověřit, že žádný channel config nepoužívá `llama/qwen` zkratku; ověřit `config.insightDefaultLang` == `INSIGHT_DEFAULT_LANG ?? 'cs-CZ'` (Maestro `callMaestro` JE replikováno v `lib/providers/maestro.ts`, neztratí se).
>
> **Bonus:** po migraci `story-consult.ts` smazat jeho ručně psaný try/catch fallback (:262,:285) — camel `executeWithFallback` dá registry-backed chain zdarma (resilience upgrade).
> **ZAMÍTNOUT** jakoukoli variantu, kde přežije kebab nebo se camel slije do kebabu — kebab nemá registry/fallback/circuit-breaker/storeAtProvider → regrese všech reflection/workflow konzumentů.

Pak: ověřit testy, **smazat `llm-router.ts`**, lint guard proti `*-router.ts` vs `*Router.ts`.

**Inverze (streaming = primitiv):**
1. 🔵 `chatStream()` async generator do `InferenceBackend` (`providers/types.ts`), implementace v `openai-compat`/`openai`/`anthropic`/`gemini`/`maestro` (`stream:true` + SSE parsing).
2. 🔵 `chat()` = **konzumuj a akumuluj** přes sdílený `_executeCall(backend, request, streamMode)` — JEDNA cesta, ne dvě paralelní (jinak každý provider bugfix 2× bez nástroje na parity).
3. 🔵 `unifiedChatStream()` v `llmRouter.ts` — **pre-first-token health-check + commit backendu** (žádný mid-stream fallback; po prvním tokenu už fallback nejde).
4. CI: stejná sada testů proti `stream=true` i `false` (anti-drift).

---

## 8. Auth & PAT 🔴 (opraveno)

🟢 Reuse `validate_mcp_token`/`create_mcp_token` (hash, scope, RPM/denní, expirace).
🟡 **Přesná delta:** přidat `user_id uuid` FK do `mcp_auth_tokens` (vzor `llm_quota` PK) + `scope text[]` (dnes scalar `text`); sjednotit prefix s `create_mcp_token` (`mcp_`) nebo doplnit `/v1/auth/create-pat` wrapper. Edge middleware: `Bearer mcp_/sk-aisha-` → `validate_mcp_token` → mintnout JWT kontext + `req.user.sub = user_id`.

### 8.5 PAT story/tenant binding 🔴 BLOCKER (před Fází A)
PAT nese jen identitu uživatele, ne `story_id`/tenant → runs se `story_id=NULL` → **rozbitý chargeback, otrávený audit, přeskočená governance gate, enumerace story**. → přidat `scoped_to_story_id` do `mcp_auth_tokens`, bind-at-issuance, **odvodit story z PATu** (ignorovat/validovat body), **fail-closed** když neurčeno. §16 „multi-tenancy invariant" tím povýšit z aspirace na vynucenou bránu. **Nepouštět `/v1` bez tohoto.**

---

## 9. Kvóty & admission 🔴/🟡

🟡 Reuse `packages/security/src/rateLimit.ts`: `routeRateLimit('expensive')` (10/min) + `keyByUserOrIp()` (preferuje `req.user.sub`).
🔴 **Pre-flight admission jako Phase A guardrail (NE pozdější epocha):** sdílený `enforceQuota(user_id, estTokens, estCostUsd)` middleware nad `fn_check_and_consume_llm_quota_audited` (jednotné 402/429) **PŘED dispatchem** + rekonciliace **PO** (skutečné tokeny ze streamu) + **mid-stream sampling** (~per 100 tokenů) pro včasné 429 (stream nemůže vrátit 4xx po prvním bytu). Plus `fn_admit_branch` concurrency cap (fanout = fork-bomb bez něj). Pozn.: node-level budget gate v orchestrator.ts existuje, ale neochrání synchronní turn před spuštěním.

---

## 10. Broadcast triggery 🔵 (generická factory)

🔵 Extrahovat **`fn_pg_notify_broadcast(channel text, topic text, record jsonb)`** (dnes 17 hand-coded pg_notify funkcí kopíruje boilerplate) → tenké volající:
- `fn_broadcast_run_progress` — AFTER INSERT/UPDATE na `ai_trace_events`; **whitelist sloupců + guard velikosti payloadu + PII filtr** (hot tabulka; `pg_notify` není truly async → může blokovat INSERT).
- `ai_workflow_node_runs` — broadcast **jen terminální stavy** (ne každý UPDATE).
- `fn_broadcast_nudge` — AFTER INSERT na `dirigent_nudges` → `workspace:`/`session:` topic.

Migrace do živé baseline; doplnit `realtime_broadcast` do event-worker config, pokud chybí. (Pokud load test ukáže trace-storm blokádu INSERTů → async outbox, defer v1.1.)

---

## 11. Governance on-prem-only gate 🔵

🔵 `detectDataSensitivity(messages, ragContext) → {public|internal|confidential, tables[]}` (kotva: citlivé tabulky + RAG provenance) → `canUseCloudApis`/`dataSensitivity` do `GovernanceDecision`; při `confidential` tvrdě `clow.allow_local=true` + filtr cloud kandidátů (resolver `allow_local` už konzumuje). **Klasifikace musí být rychlá** (žádné těžké RLS joiny blokující 200 OK/SSE handshake) a **Omni i warm evaluátor sdílí JEDEN verdikt** (jinak fork residency). Audit do `audit_journal`. DoD #5.

---

## 12. Supervize lokálního Dirigenta 🟢 + 🔵

🟢 Vše živé (baseline-absorbed): sync gating, `dirigent_nudges` producent (governance), `story_goal_state` Stop-loop, 5 consult RPC, `fn_detect_agent_runaway` watchdog. **Smyčka potřebuje jen push-delivery rozšíření**, ne novou supervizní logiku.
🔵 Push: nudge trigger (§10) + `nudge`/`decision` ve **3 schématech** (§4.4) + teplý rychlý evaluátor ≤4 s (`unifiedChatStream`, levný local tier).

---

## 13. Korekce vůči původnímu zadání

1. „Pollovat Langfuse" → NE; existující fabric (Langfuse jen audit).
2. „VRAM hot-swap" → mimo v1 (vLLM staticky).
3. Streaming = dva proudy, dva transporty (token in-process; stav přes fabric) + consistency contract.
4. Ne každý dotaz = plný běh — complexity-routed (povinné).
5. „model" → rodina tierů; OpenAI **i** Anthropic protokol.
6. Tři „gateway" → jeden produkt, decision tree podle `Authorization`.

---

## 14. Fázový plán + pořadí refactoringu

### PŘED Fází A (gaty)
1. 🔴 **Load test event-loopu** → in-process vs standalone `svc-omni`.
2. 🔴 **Konsolidace routerů** (`evaluate.ts`+`story-consult.ts` → `llmRouter.ts`, smazat `llm-router.ts`, lint guard) — jinak streaming forkne do dvou routerů.
3. 🔴 **Inverze streaming primitivu** (`chatStream()` + `chat()`=accumulate + `unifiedChatStream` s pre-first-token commit + CI matrix).
4. 🔴 **PAT story/tenant binding** (`user_id` FK + `scope text[]` + `scoped_to_story_id` + fail-closed).

### BĚHEM Fáze A
5. 🔵 Generická broadcast factory + `run_progress`(whitelist/PII)+`nudge`; terminal-only na node_runs; do živé baseline.
6. 🔵 `/v1` ingress (streamovací proxy NIKDY `arrayBuffer`; `v1-chat.ts`; eager resolver; mandatory complexity routing; OpenAI+Anthropic; chunk + `[DONE]`).
7. 🔵 PAT auth + sdílený `enforceQuota()` (pre+post+mid-stream sampling) + `routeRateLimit('expensive')`.
8. 🔵 ide-bridge push (3 schémata) + ověřit `workspace:`/`session:` topic doteče přes ws-gateway.
9. 🔵 Governance residency gate (DoD #5; sdílený verdikt, rychlá klasifikace).
10. 🔵 Consistency contract + run-state snapshot (konvergence lane).

### PO / DEFER
11. 🟡 theopenco AGPL → NOTICE + právní stanovisko (před externím vydáním).
12. ⏸️ SSE durability/resume (sequence numbers, run-state snapshot 1/s) — v1.1.

---

## 15. Konfigurace & nasazení 🟡/🟢
Compose dle vzoru `coolify-llm-gateway.yml` (nebo `/v1` route v `@aisha/gateway`); env `LANGFUSE_*`/`REDIS_*`/`POSTGREST_SERVICE_TOKEN`/`KC_*`; registry seed rodiny `aisha-*` v `ai_provider_registry`; IDE klient `Base URL=https://omni.…/v1`, key=PAT; distinct host od passthrough.

---

## 16. Invarianty, rizika, bezpečnost

- 🟢 Multi-tenancy: `clow`/run nese tenant+`story_id` (vynuceno přes §8.5 PAT binding); user = PAT→`user_id`, nikdy z body.
- 🟢 Auth split: `/v1` = PAT/JWT; interní `/reflect/runs` = service-role.
- 🔵 SSE: keep-alive `: ping`, idle-timeout, resume přes `run_id`+sequence; edge NESMÍ bufferovat.
- 🔵 PII: filtr trace delt; governance gate i pro stream.
- 🟡 **Licence: theopenco/llmgateway (AGPLv3) je aktivně integrován jako backend (`createGatewayBackend` openai-compat.ts:379) — doplnit do NOTICE + právní stanovisko před externím vydáním. NETvrdit non-impact bez review.**
- ⚠️ `chat.ts` (55 KB) NEforkovat — volat `orchestrationBridge` + `/reflect/runs`.

**Residual rizika:** event-loop kontence (gate=load test); mid-run split-brain (PG↔Redis partition; id3a double-proxy historie); `pg_notify` backpressure na hot tabulce; streaming quota overage; PAT multi-user/workspace; AGPL; governance latence/fork verdiktu; phase-coupling (Phase A DoD #1 blokováno na streaming+router+non-buffering edge landing společně).

---

## 17. Definition of Done + 17.5 marketing gate

1. Funguje jako custom provider v Cursoru, **streamuje tokeny**. *(A)*
2. Složitý dotaz → reflection běh + sandbox; jednoduchý → rychlá cesta. *(A→B)*
3. Plynulý stav i při self-heal prodlevách. *(B)*
4. Lokální Dirigent dostává správné a včasné (mid-run) korekce. *(C)*
5. „Přísně důvěrná" data izolována lokálně, cloud blokován. *(D)*

### 17.5 Marketing gate 🔴
**Nepropagovat Omni jako „model" dokud nejsou E3 (cost metering+admission) + E4 (quality floor+adaptive routing) + mid-run push (C).** Do té doby „experimental orchestrator proxy" / internal-only. Každá DoD řádka navázaná na epochu + řádek verifikačního ledgeru, který musí zezelenat.

---

## 18. Souhrn REUSE / NEW / VALUE

| Schopnost | Stávající (🟢) | Nově (🔵/🟡) | Přínos |
|---|---|---|---|
| Orchestrace/cascade/self-heal/supervize | reflection, llmRouter, resolver (živé), OpenClaw, dirigent-supervisor | — | nulová duplikace |
| Tokenový streaming | — | `chatStream`/`unifiedChatStream` (invertovaně) | fungovat jako provider |
| OpenAI+Anthropic plocha | — | `/v1/chat/completions`+`/v1/messages` | reach na všechna IDE |
| Identita modelu | — | rodina `aisha-*` tierů | 1:1 cost/latency |
| Stav/„myšlení" | fabric + `react_thought` | generická broadcast factory + projektor | viditelné myšlení |
| Feedback lokálu | dispatch, nudges, goal-state, consult, watchdog (živé) | push (3 schémata) | včasná mid-run korekce |
| Auth/kvóta/rate-limit | `mcp_auth_tokens`, `validate_mcp_token`, `rateLimit.ts`, `fn_…_quota` | `user_id` FK + story binding + pre-flight gate | paste-once + ochrana nákladů |
| On-prem gate | governance kostra, `allow_local`, RLS | klasifikátor + `canUseCloudApis` | důvěrnost (DoD #5) |
| Routery | `llmRouter.ts` | konsolidace + smazat `llm-router.ts` | jeden zdroj pravdy |

---

## 19. Whole-stack funkční analýza (grounded, 65 agentů, 45 nálezů ověřeno / 6 zamítnuto)

**Verdikt: CONDITIONALLY COHERENT.** Engine JE jeden univerzální story-scoped celek — všechny vnitřní povrchy (workbench, dirigent extension, mobile, `/chat`, `/reflect`, `/generate`, `/dirigent/dispatch`, `/public-chat`) tečou přes **jeden response engine** (`svc-ai-chat`), jehož rozhodovací vrstva je `orchestrationBridge` (`classifyMessageComplexity:1034`→`selectOptimalModel:1212`→`routeViaAisha:445`) nad DB autoritami (`route_task.sql`, `aisha_resolve_clow_backend.sql` baseline:17681). Routery = exekutoři. Fabric live. **ALE Omni `/v1` v kódu NEEXISTUJE** a žádný ze 4 pre-Phase-A gatů nezapojen. Dnes stack funguje jako pre-Omni orchestrátor, NE jako OpenAI/Anthropic gateway.

### 19.1 Story-binding — centrální invariant je NEKONZISTENTNÍ (🔴 base, nezávislé na Omni)
Tvoje teze „vše drží vazbu na story" je **správný cíl, ale dnes nevynucený** — a je tam **cross-tenant díra**:
- `/chat`: `get_chat_context_story_id` nevaliduje ownership při explicitním `p_story_id` (jen existenci) a **fallback vrací LIBOVOLNOU aktivní story** (ř. 42-50) → mezi-tenantní únik, **nezávislý na Omni**.
- `/dirigent/dispatch`: `user_id` z JWT (trusted), ale `story_id` z **body bez ownership checku** — asymetrické.
- `/v1`: nemůže honorovat (schema gap — viz §8.5).
- `/public-chat`: bez story by design.
- **Fix (base):** jeden sdílený `resolveAndValidateStoryId(userId, explicitStoryId?, pgrest)` pro všechny JWT routy; PAT routy odvozují ze scope; opravit resolver (ownership + zrušit arbitrary-active fallback); **invariant `ai_runs.story_id NOT NULL`** nese RLS/chargeback/governance/audit.

### 19.2 Další duplicity (kromě dvou routerů)
- `resolveProvider` 2× (`llm-router.ts:48` vs `llmRouter.ts:189`) — vyřeší se smazáním kebabu.
- `AishaPushEvent` 2× (`aisha-push.ts` + `workbench-core/ISseClient`) → 1 SoT (viz §4.4 korekce).
- `EscalationSignal` 2× (`governedOrchestration.ts:41` vs `orchestrationBridge.ts:964`) → kanonizovat na governedOrchestration.
- 17 hand-coded `pg_notify` funkcí → factory `fn_pg_notify_broadcast` (§10).

### 19.3 Nezapojené / rozbité (co Omni předpokládá, ale neběží)
- `classifyMessageComplexity` běží, ale **tier nikdy nevětví exekuci** (`chat.ts:875` vždy synchronní `engine.execute()`) → **§6.5 dnes porušeno pro VŠECHNY requesty**.
- `chooseExecutionStrategy:1308` + `kickOffReflectionWorkflow:1342` — **0 volajících** (repo-wide grep).
- Governance: `resolveGovernanceDecision` se volá (`index.ts:783`) ale **AŽ PO `selectOptimalModel`** → nemůže ovlivnit cloud-vs-local; `detectDataSensitivity` **neexistuje** → residency nikdy neklasifikována (DoD #5 nesplněno).
- `reflect.ts POST /reflect/runs` nevaliduje existenci run → bogus UUID = 202, pak tichý fail.
- Model discovery: `/models/list` je admin-only + OpenAI-only; registry availability není přes HTTP; `aisha_resolve_clow_backend` je SECURITY DEFINER, **bypassuje RLS** → každý auth uživatel enumeruje všechny modely, per-instance restrikce nevynutitelná.

### 19.4 Báze vs instance (VERIFIED WORKING + 1 GAP)
- **BÁZE vynucuje (nikdy fork):** `/v1` ingress, complexity routing, resolver, PAT validace + story-scope, governance/residency gate, pre-flight quota, streaming engine, jeden response engine.
- **BÁZE je env-driven — „uses what it has":** model discovery čte `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`OLLAMA_URL`/`VLLM_GENERATION_URL` přes factory (null když unset); `AISHA_EXECUTION_MODE` (local|hybrid|cloud) gatuje; tiery fallback env→DB(`get_adaptive_model_tiers`)→default. **VERIFIED WORKING.**
- **INSTANCE customizuje JEN přes:** config overlay (`config/domains-<profile>.env`), DB seedy, delimited fork složky (`aisha/db/sql/tables/cheers/`, `src/cheers/`, …). **NESMÍ** přidávat tenant kód do routing/gateway/governance.
- brand/domain→tenant = runtime DB (`branding_hostname_mapping`). **VERIFIED WORKING.**
- 🔴 **GAP:** per-instance restrikce modelů NENÍ vynutitelná na registry RLS (registry čte každý auth uživatel; resolver SECURITY DEFINER bez tenant filtru). Pokud třeba tvrdé gating → přidat instance-scoped RLS **do báze**, ne do instancí.

---

## 20. Test & change plan (whole-stack, base, s regresními pojistkami)

### P0 — PŘED Fází A (gaty, base)
1. **Konsolidace routerů** + parity test (5 providerů × `stream=true/false`, identický text+tokeny) → pak smazat `llm-router.ts`.
2. **Inverze streaming primitivu** (`chatStream` + `chat`=accumulate + `unifiedChatStream` pre-first-token commit + CI matrix).
3. **PAT story binding migrace** (`mcp_auth_tokens` + `user_id` FK + `scoped_to_story_id` + `scope text[]`; `validate_mcp_token` vrací `{user_id, story_id}`).
4. **Load test event-loopu** (in-process vs standalone).
5. **Story-resolver ownership fix** (base, nezávislé na Omni — §19.1; cross-tenant díra).
6. **Wire `classify/chooseStrategy/kickOff` do `/chat`** (dnes 0 volajících → §6.5 jinak zůstane porušené).

### P0 — Fáze A
7. `routes/v1-chat.ts` (eager resolver, complexity branch SSE vs 202, OpenAI+Anthropic, `/v1/models`).
8. Broadcast factory `fn_pg_notify_broadcast` + `run_progress`(whitelist/PII)+`nudge`; terminal-only na node_runs; do baseline.
9. `detectDataSensitivity` **PŘED** `selectOptimalModel` → `allow_local` + filtr cloud (DoD #5).

### P1 — Fáze A
10. Sdílený `enforceQuota()` (pre-dispatch 402/429 + reconcile + mid-stream sampling + `fn_admit_branch`).
11. Streamovací `v1.ts` proxy (`@fastify/http-proxy` pipe, NIKDY `arrayBuffer`).
12. `AishaPushEvent` SoT + `nudge`/`decision`; sdílený `resolveAndValidateStoryId` do `/dirigent/dispatch`+`/story-consult`; registry RLS + veřejné `GET /v1/models`; echo `conversation_id` v chuncích.

### Regresní pojistky (MUSÍ existovat před landing každé změny)
router parity · streaming-vs-202 per tier (tier1/2 SSE <500ms p95; tier3+ 202+poll) · `conversation_id` statefulness (stateless/multi-turn/chaining) · **PAT multi-tenant isolation matrix** (scoped vs unscoped, story mismatch→403, vše `story_id NOT NULL`) · broadcast pgTAP+e2e (INSERT→NOTIFY→ws-gateway <100ms, PII filtr, neblokuje INSERT pod trace-storm) · governance residency (confidential→žádný cloud call) · pre-flight quota (402 před prvním bytem) · **story-resolver ownership** (cizí story→fail-closed) · edge non-buffering load test · schema evolution graceful degrade (neznámý event type nespadne).

---

## 21. Akceptační sada + main-sync reconciliation (v5)

**Executable spec** existuje na větvi `test/omni-acceptance-suite`: 16 unit + 7 e2e + 8 pgTAP souborů, 10 oblastí, pozitivní/negativní/**false-positive**. Spuštění (vyžaduje **Node 22**, `.nvmrc`):
```bash
bash runtests.omni-acceptance.sh        # vitest acceptance (ALL=1 + e2e + pgTAP)
```
Izolace: vlastní `vitest.omni-acceptance.config.ts`; cesta `src/tests/omni-acceptance/**` je vyloučená z default `vitest.config.ts` → běžné CI zůstává zelené.

**Stav po sladění s `origin/main` #450 (E0 merged):** suite je **platná** — **14 LIVE-RED guardů = akceptační cíle** (dokazují reálné bugy na aktuálním mainu), 67 zelených (zamykají správné chování), zbytek `skip-until-impl`/`todo`. Žádný guard není falešná E0-regrese. Realigned (jen text/odkazy, zůstávají RED):
- `preflight-admission` → cílí na merged `fn_admit_clow` (ne na neexistující `enforceQuota`).
- `governance-residency #2` → opravené `baseline.sql` řádky + poznámka, že `fn_admit_clow` je ortogonální (neklasifikuje citlivost).

**Pořadí red→green (vč. Epoch zarovnání) — „až pak vývoj":**
1. **BASE / pre-Fáze A** (nezávislé na Omni, ZADÁNÍ §3.1): story-binding ownership do `get_chat_context_story_id` + `/dirigent/dispatch` + `/reflect/runs`; `ai_runs.story_id NOT NULL`.
2. **#1 router konsolidace** (6 RED, E0-independent): `evaluate.ts`+`story-consult.ts` → camel `llmRouter`, `result.usage.*`, smazat kebab.
3. **#2 reflect run-existence** (1 RED): `loadRun(run_id)` před `void runWorkflow()` → 404 + ownership.
4. **#3/#4 residency** (governance, ZADÁNÍ §11): `detectDataSensitivity` PŘED `selectOptimalModel`; hard cloud-filter při confidential.
5. **#5 pre-flight admission** (ZADÁNÍ §6.1/I6): zapojit `fn_admit_clow` do `chat.ts`/`/v1` před `engine.execute()` (deny→402, ask→202, journal `decision_id`).
6. **#6 tier branching** (ZADÁNÍ E1 §4.1): `classify/chooseStrategy/kickOff` do `/chat` (SSE vs 202).
7. **DOC**: tyto v5 delty (hotovo) v PR clusteru s #5/#6.

Doporučené pořadí PR dle nezávislosti: base story-binding → (#1 ∥ #2) → (#3,#4) → #5 → #6 → doc.

---

## 22. FINÁLNÍ IMPLEMENTAČNÍ PLÁN (mechanism-grounded, v6)

Po důkladném průchodu celého ZADÁNÍ + všech vazeb proti **reálnému kódu** (21 agentů, adversariálně ověřeno) — autoritativní plán. **Pravidlo: každý krok jmenuje REÁLNÝ mechanismus a guard, který vynutí skutečně cílený dynamický stav — ne mechanickou náhražku.** Lekce `resolveProvider`→`resolveAvailableModel` je vzorem: plán nesmí „projít zamalováním".

### 22.1 Painted-over gapy (8 — najít a zavřít)
1. **STATIC-PROXY dynamického výběru (4 ŽIVÉ klastry)** — `proactiveEngine.ts:418/423/426`, `generate.ts:186`, `workflowEngine.ts:197/804/879/920`, `criticLoop.ts:302/331/479` volají `resolveProvider(model)`→`unifiedChat` BEZ `resolveAvailableModel` → na selektivně nakonfigurované instanci hodí „No available backend". *(evaluate.ts + story-consult.ts už GREEN — commity f200d8c4/3ee83fc2.)* **Invariant: každé `unifiedChat` volání předchází `resolveAvailableModel` nebo `dispatchDecision`.**
2. **ADMISSION konflace** — plán/ZADÁNÍ prózou říkaly „enforceQuota() nad fn_check_and_consume_llm_quota_audited" (spend-only). REÁLNÝ mechanismus je **`fn_admit_clow`** (`baseline.sql:31080-31307`, 4 osy spend/runtime/capability/risk, žádné allow-listy), zapojený v reflection (`openclaw_resolve_clow.ts:38`), **NE v chat.ts**. Nestavět nový middleware — **reuse `fn_admit_clow`**.
3. **GOVERNANCE ordering + chybějící `detectDataSensitivity`** — `resolveGovernanceDecision` běží AŽ PO `selectOptimalModel` (nemůže ovlivnit cloud-vs-local); `detectDataSensitivity` neexistuje; resolver `allow_local` je **+0.20 boost, ne hard cloud-filter**.
4. **TIER nikdy nevětví** — `classifyMessageComplexity`+`selectOptimalModel` tier spočítají (a `selectOptimalModel` správně volá `resolveAvailableModel` → falešná jistota), ale `chat.ts:875` vždy synchronní; `chooseExecutionStrategy`(:1308)+`kickOffReflectionWorkflow`(:1342) mají **0 volajících**.
5. **STORY ownership nevynucen (3 povrchy)** — `resolveChatStoryId:141` vrací body story bez ownership; `get_chat_context_story_id` existence-only + arbitrary-active fallback (cross-tenant únik); `dirigent-supervisor` věří body.story_id (6 míst); `mcp_auth_tokens` bez `user_id`/`scoped_to_story_id`; `ai_runs.story_id` NULLABLE.
6. **STREAMING buffered-only** — žádný `chatStream`/`unifiedChatStream`; guard kontroluje jen syntaktickou ne-existenci (slabý).
7. **BROADCAST producent chybí** — fabric (konzument) žije, ale `fn_pg_notify_broadcast` factory + triggery neexistují; `decision_id` je metadata, NE routing key (topic = `run:<run_id>`).
8. **PAT tenancy schema** — `validate_mcp_token` nevrací `user_id`/`story_id` → PAT-authed runs `story_id=NULL`.

### 22.2 Ordered steps (mechanismus → soubory → guard → síla → závislosti)

| Krok | Epocha | Mechanismus | Soubory | Enforcing guard | Guard OK? | Závisí |
|---|---|---|---|---|---|---|
| **E1-1** | E1 | `resolveAvailableModel` na 4 zbylých static-proxy klastrech | proactiveEngine, generate, workflowEngine, criticLoop | router-consolidation (rozšířit na 4 klastry) **+ nový repo-wide invariant guard** | 🔴 **zpřísnit první** | — |
| **BASE-1** | BASE | `mcp_auth_tokens` (user_id FK + scoped_to_story_id FK + scope text[]) + `ai_runs.story_id NOT NULL` + `validate_mcp_token` vrací user_id+story_id | mcp_auth_tokens.sql, validate_mcp_token.sql, migrace | pat-tenancy (přidat RUNTIME isolation test) | 🔴 zpřísnit | — |
| **BASE-2** | BASE | `get_chat_context_story_id` ownership fix (owner match + zrušit arbitrary-active fallback) | get_chat_context_story_id.sql | story-resolver-hole pgTAP | ✅ | BASE-1 |
| **E-Omni-1** | E-Omni | sdílený `resolveAndValidateStoryId` (owner-check/403) | storyResolver.ts, chat.ts, dirigent-supervisor.ts | story-resolver-hole (přidat HTTP 403 pro KNOWN-VALID event) | 🔴 zpřísnit | BASE-1,2 |
| **E-Omni-2** | E-Omni | `fn_admit_clow` pre-flight v chat.ts před `engine.execute()` (deny→402/403, ask→202) | chat.ts | preflight-admission | ✅ silný | E-Omni-1 |
| **E-Omni-3** | E-Omni | `detectDataSensitivity` PŘED `selectOptimalModel` (chat.ts **i** evaluate.ts, jeden verdikt) + resolver **hard** cloud-filter | governedOrchestration.ts, chat.ts, evaluate.ts, aisha_resolve_clow_backend.sql | data-sensitivity #1/#2/#3 | ✅ silný | E1-1 |
| **E-Omni-4** | E-Omni | tier branching: `chooseExecutionStrategy`+`kickOffReflectionWorkflow` → tier3+ 202+poll | chat.ts | tier-never-branches + v1-stream-vs-202 | ✅ silný | E-Omni-2,3 |
| **E-Omni-5** | E-Omni | streaming inverze: `backend.chatStream` + `unifiedChatStream` **používá `resolveAvailableModel`** | llmRouter.ts, providers/*, types.ts | streaming-engine | 🔴 **zpřísnit** (assert resolveAvailableModel + no mid-stream fallback) | E1-1, E-Omni-4 |
| **E-Omni-6** | E-Omni | broadcast factory + triggery (topic `run:<run_id>`, decision_id = metadata) | fn_pg_notify_broadcast.sql, fn_broadcast_*.sql, triggery, sse/schemas.ts | broadcast-realtime pgTAP | ✅ | E-Omni-4 |

### 22.3 Guardy ke zpřísnění PŘED odpovídajícím krokem (anti-painting-over)
- **router-consolidation** → pokrýt 4 klastry + **repo-wide invariant**: žádné `unifiedChat({provider: resolveProvider(...)})` mimo `resolveAvailableModel` wrapper + LIVE selektivní-config test (jen `ANTHROPIC_API_KEY` → proactive/workflow/generate remapují, nikdy „No available backend"). *(před E1-1)*
- **streaming-engine** → assert `unifiedChatStream` VOLÁ `resolveAvailableModel` + NEGATIVE žádný `executeWithFallback` po prvním tokenu + stejná sada proti stream=true/false (vč. usage/finish_reason parity). *(před E-Omni-5)*
- **story-resolver-hole** → HTTP-layer 403 pro KNOWN-VALID event s cizí body.story_id (ne jen unknown event). *(před E-Omni-1)*
- **pat-tenancy** → RUNTIME test: PAT vázaný na story A odmítnut při story B (ne jen has_column). *(před BASE-1 done)*

### 22.4 Otevřená rizika (rozhodnout při implementaci)
- `ai_runs.story_id NOT NULL` → backfill/kvarantén orphan NULL řádků PŘED constraintem.
- Hard cloud-exclusion při confidential → na instanci bez lokálního backendu = zero candidates → fail-closed deny; definovat deny-vs-degrade; `detectDataSensitivity` false-positives nesmí zaškrtit běžný provoz.
- `detectDataSensitivity` musí být rychlé (<100 ms) a nesmí minout citlivost z tool-outputs/mid-conversation (jinak tiše routuje confidential do cloudu — přesně to, čemu §11 brání).
- `fn_admit_clow` na hot-path: admission RPC round-trip vs §6.5 tier1/2 first-token <500 ms p95 → fast-path pro tier1/2 bez oslabení gate.
- AST/lint invariant je heuristika → **LIVE selektivní-config integrační test je skutečná pojistka** (povinný CI gate).
- PAT `scoped_to_story_id NOT NULL` = tvrdá tenancy změna → invalidovat staré PAT (re-issuance) vs grandfather (znovuotevře díru); fail-closed re-issuance bezpečnější.
- `dirigent-supervisor` body.story_id na 6 místech → `resolveAndValidateStoryId` protáhnout všemi (minout jedno = znovu díra).

---

## 23. Whole-stack verifikační smyčka (test-first → unit → integrace → e2e)

**Princip (povinný pro každý krok):** testy PŘED programováním (z zadání) definují „správně"; implementace je flipne RED→GREEN; pak se ověří v **kontextu celého stacku** integračními (pgTAP, živá DB) a e2e (Playwright proti zvednutému devstacku) testy. Žádný krok není „hotový", dokud nezezelenají všechny tři vrstvy.

### 23.1 Tři vrstvy + příkazy
| Vrstva | Co ověřuje | Příkaz | Stav |
|---|---|---|---|
| **Acceptance/unit (spec-as-tests)** | implementace odpovídá zadání | `OMNI_ACCEPTANCE=1 vitest run --config vitest.omni-acceptance.config.ts` | 16 souborů, 8 RED = cíle |
| **Integrace (pgTAP, živá DB)** | DB funkce/triggery/RLS reálně fungují | proti devstack DB: `pg_prove -d $AISHA_DB_URL aisha/db/tests/schema/omni/*.sql` | 8 souborů, 97 assertů |
| **e2e (celý stack)** | ingress→engine→DB→odpověď end-to-end | `npm run test:e2e:devstack -- omni/` (+ `OMNI_ACCEPTANCE=1 OMNI_BASE_URL=<edge> OMNI_PAT=…`) | 33 testů, 7 oblastí (reálné, gated) |

`scripts/e2e/run-devstack.mjs` zvedne `aisha-local` stack (env-complete), naprovisuje uživatele (KC+DB), spustí Playwright, zbourá — **jeden příkaz, žádné manuální kroky**. Offline vrstvu (tsc+lint+~5173 gates+~5400 unit) už vynucuje pre-push stack-smoke.

### 23.2 Per-krok verifikace (kdy která vrstva ověří co)
| Krok | unit (RED→GREEN) | pgTAP (živá DB) | e2e (devstack) | Runnable e2e kdy |
|---|---|---|---|---|
| **E1-1** ✅ | router-consolidation invariant | — | regression-coherence (engine health) | **teď** (jen OMNI_BASE_URL) |
| **BASE-1** | pat-tenancy (schema/return) | `pat-tenancy.sql` (sloupce/FK) | pat-tenancy (PAT scoped) | po BASE-1 (provision scoped PAT do devstacku) |
| **BASE-2** | story-resolver-hole | `story-resolver-hole.sql` (ownership) | — | — |
| **E-Omni-1** | story-resolver-hole HTTP | — | story-resolver (dispatch+/chat 403) | po E-Omni-1 (tenant-B JWT) |
| **E-Omni-2** | preflight-admission | quota-admission.sql | quota-admission (402/202) | po /v1 |
| **E-Omni-3** | data-sensitivity ×3 | governance-residency.sql | governance-residency (confidential→no-cloud) | po /v1 |
| **E-Omni-4** | tier-never-branches | — | streaming-routing (SSE vs 202) | po /v1 |
| **E-Omni-5** | streaming-engine | — | streaming-routing (token stream) | po /v1 |
| **E-Omni-6** | broadcast-realtime | broadcast-realtime.sql | broadcast-realtime (push <100ms) | po triggerech |

### 23.3 Co je potřeba zadrátovat (pre-req pro plnou e2e jistotu)
1. **Omni env do devstack runneru:** `run-devstack.mjs` musí pro `omni/` specy nastavit `OMNI_ACCEPTANCE=1` + `OMNI_BASE_URL=<devstack svc-ai-chat/edge>` + (po BASE-1) naprovisovat **story-scoped PAT** → `OMNI_PAT`/`OMNI_PAT_SCOPED_A` + tenant-A/B JWT (`OMNI_TENANT_A_JWT`/`_B_JWT`). Bez toho e2o specy self-skip (zelené, ale neověří).
2. **pgTAP omni do harness:** přidat `aisha/db/tests/schema/omni/` do `run-schema-tests` proti devstack DB.
3. Tím se z „self-skip" stane reálné RED→GREEN ověření proti živému stacku per krok.
