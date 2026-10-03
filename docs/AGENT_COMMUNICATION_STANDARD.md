# Agent Communication Standard (ACS) — analýza dopadů, injection mapa, plán vývoje

> **Status:** **v1.2 — implementováno (F0–F5 core)**: `packages/acs-sdk` + `packages/acs-contracts`, migrace `aisha/db/migrations/20260708*`, IP-4/IP-8/IP-11 zapojeny za `ACS_MODE` (default off, No Regressions). Rollout: [acs/ACS_ROLLOUT_RUNBOOK.md](acs/ACS_ROLLOUT_RUNBOOK.md) · Rozhodnutí: [adr/ADR-001-acs-implementation.md](adr/ADR-001-acs-implementation.md) · Audit v1.0→v1.1: [ACS_AUDIT_FINDINGS.md](ACS_AUDIT_FINDINGS.md)
> **Datum:** 2026-07-08
> **Souvisí:** [ARCHITECTURE.md](ARCHITECTURE.md), [AISHA_ORCHESTRATION_PLAN.md](AISHA_ORCHESTRATION_PLAN.md), [proposals/AISHA_ORCHESTRATION_MASTERPLAN.md](proposals/AISHA_ORCHESTRATION_MASTERPLAN.md), [proposals/TREE_OF_THOUGHTS_REFLECTION.md](proposals/TREE_OF_THOUGHTS_REFLECTION.md), [N8N_AGENT_ARCHITECTURE.md](N8N_AGENT_ARCHITECTURE.md), [LLM_ROUTER.md](LLM_ROUTER.md), [enterprise/SOURCE_ONBOARDING_CONTRACT.md](enterprise/SOURCE_ONBOARDING_CONTRACT.md)

---

## 0. Problém a princip

Mezi-agentní komunikace, jejíž správnost závisí na tom, že příjemce správně *pochopí* prózu, degraduje s každým hopem: každé předání = re-enkódování významu, chyby se skládají multiplikativně. Při věrnosti 97 % na hop dorazí po 5 hopech nezkreslených jen ~86 % úloh (0,97⁵) — a nelze dohledat, kde se význam zlomil.

**Princip ACS:** význam nese struktura, ne interpretace. Interpretace se smí objevit jen tam, kde je strojově ověřitelná proti kanonickému originálu.

### Sedm pravidel

| # | Pravidlo | Podstata |
|---|----------|----------|
| R1 | Vznik zprávy = vyplnění kontraktu | Structured output proti schématu, validace **před odesláním** — nevalidní sdělení nemůže vzniknout |
| R2 | Oddělená řídicí a datová rovina | Akce/stav/priorita = uzavřené enumy; přirozený jazyk je vždy jen payload, nikdy instrukce |
| R3 | Kanonický intent + pass-by-reference | Zadání se zmrazí jako immutable artefakt; agenti předávají `intent_id` + typované anotace, nikdy parafráze |
| R4 | Contract-first registr | Každý message typ má schéma + verzi + psanou sémantiku; nevalidní → reject + DLQ, nikdy coerce |
| R5 | Readback kritických operací | Propose → strojové porovnání interpretace s intentem → confirm → execute |
| R6 | Envelope + least privilege | `message_id`, `correlation_id`, `causation_id`, sender, verze schématu, podpis; ACL na typy zpráv |
| R7 | Verifikace proti originálu | Nezávislý verifier porovnává finální výstup s kanonickým intentem, nikdy s mezikroky |

---

## 1. Analýza dopadů

### 1.1 Dopad na komponenty repa

| Komponenta | Současný stav | Dopad ACS | Rozsah |
|------------|---------------|-----------|--------|
| `services/svc-ai-chat/src/lib/llmRouter.ts` + `packages/llm-dispatch` (BackendRegistry) | Multi-provider abstrakce (OpenAI/Anthropic/Google/Ollama/Docker/vLLM/MLX), `unifiedChat`; bez vynucení structured output | Jediné místo vynucení schema-constrained generace + validate-before-return (R1) | Střední |
| **`services/svc-ai-chat/src/reflection/*` (reflection engine + ToT)** | Grafový orchestrátor s checkpointingem a auditem uzlů; ToT v1 na main; graf JSONB **bez registru/verzí**, výstupy nodů bez schema validace před merge do state | Viz §4 — nejrychlejší kumulace šumu v platformě; IP-11 | **Velký** |
| `services/svc-ai-chat/src/lib/toolExecutor.ts` | Parametrická validace, channel `allowed_tools`, guardrails, SSRF guard; bez readbacku, bez derivation provenance | Effect guard (R5) + derivation marking (R3) | Střední |
| `services/svc-ai-chat/src/lib/rpcAdapter.ts` + `src/postgrest.ts` | Vlastní PostgREST vrstva (`rpcService`/`rpcUser`); rpcAdapter je compat shim | Outbound/inbound envelope validace na této vrstvě | Malý–střední |
| `services/svc-ai-chat/src/routes/chat.ts` | Ingress chat flow; `run_id` + OTel `traceparent` existují | Canonicalizace intentu při vstupu (R3) | Střední |
| `services/event-worker/src/worker.ts` | Konzument PG LISTEN/NOTIFY → Redis + webhook routing; fire-and-forget JSON bez verzí, dedup a podpisů | Inbound middleware: podpis, dedup, ACL, DLQ (R4, R6) | **Velký** |
| n8n vrstva (Knowledge, Compliance, Delivery, Ragnarok, Dirigent — dle [N8N_AGENT_ARCHITECTURE.md](N8N_AGENT_ARCHITECTURE.md)) | Volný JSON přes webhooky; kódové SoT orchestrace je ovšem reflection engine, ne n8n | Komunikace výhradně přes ACS gateway endpoint — enforcement mimo n8n | **Velký** |
| `services/gateway`, `services/ws-gateway` | Fastify gateway se Supabase-API-kompatibilním povrchem (rest/storage/functions/realtime proxy) — OTel trace root | Envelope enforcement na síťové hranici | Střední |
| PostgreSQL (self-hosted; DDL/seed v `aisha/db/`) | `ai_runs`, `ai_trace_events`, `ai_workflow_definitions`, `ai_workflow_node_runs` | Nové tabulky: intents, message_log, registry, DLQ, effects, ACL | Střední |
| `services/svc-agent-runner` | Runtime agentů — fronta `claude_cli_task`, wake přes NOTIFY `agent_run_queued` | Adopce ACS SDK pro send/receive | Střední–velký |

### 1.2 Systémové dopady

| Oblast | Dopad | Kvantifikace / limit |
|--------|-------|----------------------|
| Latence | +1 schema validace na hop (ajv, řádově µs–ms); readback +1 round-trip **jen** u side-effectful operací | Budget: < 10 ms P95/hop; readback P95 < 1 s; efekty typicky < 5 % provozu |
| Tokeny | Structured output je hustší než próza; pass-by-reference eliminuje opakované kopírování kontextu řetězcem | Orientačně −20 až −40 % token/task; úspora roste s délkou řetězce |
| Storage | Intent store + append-only message_log | ~1 řádek/zprávu; od F1 nutná retence + partitioning |
| Provoz | DLQ potřebuje alerting a vlastníka; registry potřebuje změnový proces | Nová operační povinnost — viz §8 Governance |
| DX | Nový message typ = schéma + verze + codegen | Počáteční friction; dlouhodobě rychlejší debugging díky lineage (dnes: OTel `traceparent` + `run_id` + Langfuse, ale bez explicitních message/intent kotev) |

### 1.3 Bezpečnostní dopady

**Prompt injection containment (největší přínos).** Dnes může text z BYOD zdroje (dokument, e-mail, web) doputovat do promptu dalšího agenta a být interpretován jako instrukce. Podle R2 je NL obsah vždy jen data — řídicí rovina je uzavřený, validovaný slovník, který z payloadu nelze zapsat. Injekce tak ztrácí přenosové médium. Vazba na [SOURCE_ONBOARDING_CONTRACT.md](enterprise/SOURCE_ONBOARDING_CONTRACT.md): klasifikace zdroje určuje `trust.source_class` v envelope a tím i politiku zacházení s payloadem.

**Least privilege (soulad s CLAUDE.md).** ACL matice sender × message_type × recipient, default deny. Agent, který nemá nasmlouvaný typ, zprávu nepošle ani nepřijme.

**Podpisy a replay.** Ed25519/HMAC per service (klíče mimo repo — No Secrets in Code); replay chráněn unikátností `message_id` + časovým oknem.

**Auditovatelnost.** Každý efekt dohledatelný až k `intent_id` — forenzní i compliance hodnota pro enterprise onboarding.

**Navazuje na existující základy, nezavádí paralelní svět.** `lib/decisionProvenance.ts` už definuje hierarchii autorit rozhodnutí (ruleset_snapshot > compliance_policy > orchestration_policy > knowledge_retrieval > model_heuristic > fallback) se zákazem tichého override — ACS ji doplňuje o *intent lineage* (odkud rozhodnutí významově pochází), OTel traceparent doplňuje o *sémantické* kotvy (`message_id`, `intent_id`), a `ai_workflow_node_runs` audit rozšiřuje na mezi-službovou vrstvu.

### 1.4 Negativní dopady a trade-offy

| Trade-off | Riziko | Mitigace |
|-----------|--------|----------|
| Rigidita uzavřených slovníků | Brzdí explorativní/sémantické úlohy | NL payload pole je legální pro obsah — zakázané je jen řízení skrz něj |
| Schema evolution overhead | Každá změna = verze | Aditivní změny = minor bez review; breaking = major + dual-run okno |
| Readback latence | Zpomalení kritických operací | Whitelist pouze side-effectful typů (write/delete/payment/deploy) |
| n8n nelze donutit používat SDK | Agenti obejdou standard | Chokepoint mimo n8n: jediný povolený endpoint `/acs/send` na gateway; přímé HTTP n8n → služby zakázat síťovou politikou |
| Verifier cost | +1 LLM volání na dokončení | Sampling: 100 % u efektů, ~10 % u read-only |
| Falešné bezpečí | Validní schéma ≠ správný obsah | Proto R7 — sémantická verifikace proti intentu, ne jen syntaxe |

### 1.5 Soulad s existujícími pravidly

ACS je vynucením stávajících pravidel CLAUDE.md na mezi-agentní vrstvě: „Reject unexpected input shapes rather than trying to coerce them" → R4; „Document public API contracts — changes require versioning" → registry; „Principle of Least Privilege" → R6 ACL; „Test All New Code" → kontraktní testy (§6). Žádné pravidlo repa není v konfliktu.

---

## 2. Injection mapa — kde a jak k vynucení musí dojít

Tři zásady injectu:

1. **Chokepoints, ne per-agent kód.** Vynucení žije v SDK, middleware a DB — agent ho nemůže obejít ani omylem. Kde chokepoint nejde vytvořit v kódu (n8n), vytvoří se na síti.
2. **Default deny.** Zpráva bez validního envelope neexistuje pro doručení — broker (DB vrstva) ji nepřijme.
3. **Shadow → warn → enforce.** Každý bod se zapíná postupně per message typ, žádný big-bang.

| IP | Kde | Co se injektuje | Mechanismus | Bypass riziko → uzavření |
|----|-----|-----------------|-------------|--------------------------|
| **IP-1** | `svc-ai-chat/src/lib/llmRouter.ts` + `packages/llm-dispatch` (BackendRegistry — skutečné dispatch jádro) | Schema-constrained generace (R1) | Provider JSON mode / tool-calling + ajv validate-before-return + bounded retry (max 2), pak eskalace | Přímý import provider SDK mimo registry → ESLint ban + code review |
| **IP-2** | Nový balíček `packages/acs-sdk` (použit v svc-ai-chat, svc-agent-runner, event-worker) | Envelope stamping: ULID `message_id`, correlation/causation, sender, `schema_ref`, podpis (R6) | `sendMessage()` jako jediná odesílací funkce; lokální validace před odesláním | Služba pošle raw JSON → zachytí IP-3 |
| **IP-3** | PostgreSQL (DDL v `aisha/db/`) — `validate_message_envelope()` funkce + trigger, volané přes vlastní postgrest vrstvu (`svc-ai-chat/src/postgrest.ts` — `rpcService`) | Centrální validace proti registru, verze check, zápis do DLQ (R4) | DB práva: `REVOKE INSERT` na tabulce + SECURITY DEFINER funkce jako jediná cesta zápisu — DB je neobejitelný chokepoint | Přímý INSERT → blokován DB granty; `pg_notify` nese jen ID (8 kB limit), payload se čte z tabulky |
| **IP-4** | `services/event-worker/src/worker.ts` | Inbound: verify podpisu, dedup (`message_id` UNIQUE), ACL check, correlation threading | Middleware před dispatch handleru | Konzument čte Redis napřímo → Redis ACL jen pro event-worker |
| **IP-5** | Codegen pipeline (rozšíření `npm run gen:ide` / AISHA Dirigent) | Typované handlery — příjemce dostává typ, nikdy raw string | Generované typy v `packages/acs-contracts` z registru | Ruční typy mimo codegen → CI diff check |
| **IP-6** | `svc-ai-chat/src/routes/chat.ts` + `services/gateway` | Canonicalizace intentu na ingressu (R3): freeze → `intents` (immutable, content-hash) → `intent_id` povinné v envelope | Ingress middleware | Interní vznik úlohy bez intentu → validace IP-3 vyžaduje `intent_id` |
| **IP-7** | `toolExecutor.ts` — wrapper transformačních toolů | Provenance: `{derived: true, source_ref, method}` na každém odvozeném výstupu (R3) | Dekorátor nad tool výsledkem | Tool mimo executor → neexistuje, executor je jediná cesta |
| **IP-8** | `toolExecutor.ts` — `execute()` před side-effectful tools | Readback (R5): propose → strojové porovnání s intent constraints → confirm → execute; stav v `pending_effects` | Whitelist efektových typů; abort path | Nový efektový tool bez klasifikace → default = efektový (deny-fast) |
| **IP-9** | Completion hook orchestrace (reflection engine / Dirigent) → verifier endpoint v svc-ai-chat | Nezávislé porovnání finálního výstupu s `intents.canonical` (R7), nikdy s mezikroky | Samostatný agent/model, sampling politika | Přeskočení hooku → úloha bez verifier záznamu nejde označit completed |
| **IP-10** | CI/CD (`.github/workflows`) | Kontraktní testy, schema-diff breaking-change detektor, zákaz merge bez verze bump | Pipeline gate | — |
| **IP-11** | Reflection node boundary — `reflection/orchestrator.ts` + registr `NODE_HANDLERS` | Zod validace výstupu **každého** nodu před merge do checkpoint state; validace graph definice proti `GraphNodeSchema`/`GraphEdgeSchema` při seed/load (schémata už v `reflection/types.ts` existují — reuse) | Handler nemůže zapsat nevalidní stav; nevalidní graf se nespustí (dnes: `node_type` je v DB text bez CHECK, graf volné JSONB — jediná brána je TS) | Přímý zápis do state mimo orchestrátor → jediná merge cesta je v orchestrátoru |

**n8n specificky:** agenti (Knowledge, Compliance, Delivery, Dirigent, Ragnarok) volají výhradně `POST /acs/send` na gateway; envelope za ně sestaví a podepíše gateway na základě jejich service identity. Enforcement tak nezávisí na disciplíně uvnitř vizuálních workflow.

---

## 3. Datový model

### 3.1 Envelope (příklad)

```json
{
  "envelope": {
    "message_id": "01J9X2K7M3QWERTYULID26CHAR",
    "schema": "acs.task.assign@2.1",
    "intent_id": "int_01J9X2JXH4...",
    "correlation_id": "01J9X2K0AA...",
    "causation_id": "01J9X2K5BB...",
    "sender": "svc-ai-chat.planner",
    "recipient": "agent.delivery",
    "sent_at": "2026-07-08T10:00:00Z",
    "signature": "ed25519:...",
    "trust": { "source_class": "internal", "derived": false, "source_ref": null }
  },
  "payload": { "…": "validováno proti acs.task.assign@2.1, řídicí pole jen enumy" }
}
```

### 3.2 Nové tabulky (PostgreSQL — DDL/seed v `aisha/db/`)

| Tabulka | Účel | Klíčové vlastnosti |
|---------|------|--------------------|
| `acs_intents` | Kanonická zadání (R3) | Immutable (DB granty: REVOKE UPDATE/DELETE), content-hash, vazba na `ai_runs` |
| `acs_message_log` | Append-only log všech zpráv | Partitioning dle času, `message_id` UNIQUE (dedup/replay) |
| `acs_message_schemas` | Contract registry (R4) | name, semver, JSON Schema, sémantika (md), status: shadow/warn/enforce |
| `acs_dead_letters` | Odmítnuté zprávy | Důvod, původní obsah, alerting hook |
| `acs_pending_effects` | Readback stavy (R5) | propose → confirmed → executed/aborted, TTL |
| `acs_agent_acl` | Least privilege (R6) | sender × message_type × recipient, default deny |

Provázání s existující telemetrií: `ai_runs.intent_id` a `ai_trace_events.message_id` (migrace v F4) — OTel/Langfuse trace zůstává, získává explicitní sémantické kotvy. Transport: `pg_notify` payload nese pouze `message_id` (+ kanál), obsah se čte z `acs_message_log` — pass-by-reference platí i na transportní vrstvě.

---

## 4. ACS × ToT — reflection engine jako první občan standardu

### 4.1 Ověřený stav (kód, ne dokumentace)

ToT v1 je na `main`: graf `reflection/graphs/reasoning-tree-reflect.json`, nody `tot_planner` / `tot_expand` / `tot_evaluate` / `tot_search`, seed `aisha/db/seed/core/33_reflection_graphs.sql`. Strom žije ve `state.tot`: `ThoughtNode {id, parent, depth, content: string, status: unevaluated|sure|maybe|impossible, score}`, `ToTPolicy {bfs|dfs|beam, wave_width, sure_threshold 0.80, impossible_threshold 0.35, max_expansions}`, routing plochým `tot_action` enumem. Audit uzlů v `ai_workflow_node_runs`, checkpointing, deliberation kernel (`deliberation/planDeliberation.ts`), `clow` kontrakt + `runtime_dispatch`; fleet mód (podstromy jako flotila runů) v návrhu dle [MASTERPLANu](proposals/AISHA_ORCHESTRATION_MASTERPLAN.md).

### 4.2 Proč je ToT kritické místo ACS

Uvnitř stromu se telephone game děje **nejrychleji v celé platformě**: `content` je volná próza, každá expanze re-enkóduje rodičovskou myšlenku, evaluace prózu interpretuje — hloubka *d* znamená *d* překódování původního zadání. Větev může být „sure" vůči svému rodiči, a přitom driftovat od zadání: **strom bez kotvy optimalizuje konzistenci se sebou samým, ne se zadáním.** Zároveň platí, že řídicí rovina ToT je už dnes z velké části čistá (uzavřené enumy, ploché routovací hodnoty) — ACS ji nechává být a tvrdí zbytek.

### 4.3 Mapování pravidel R1–R7 na ToT

| Pravidlo | Stav v ToT dnes | ACS požadavek |
|----------|-----------------|---------------|
| R1 vznik | Výstupy `tot_expand`/`tot_evaluate` se mergují do `state.tot` bez schema validace | Zod schéma ThoughtNode/verdiktu vynuceno **před** merge (IP-11) — nevalidní myšlenka nevznikne |
| R2 roviny | ✅ převážně splněno: `ThoughtStatus` a `tot_action` jsou uzavřené enumy, graf routuje na plochých hodnotách | Zákaz odvozování status/score parsováním prózy; verdikt výhradně strukturovaným výstupem evaluátoru |
| R3 intent | `content` bez kotvy na zadání; expanze staví na parafrázi rodiče | Root stromu = kanonický `intent_id`; každý ThoughtNode jej nese; expanzní prompt dostává intent **doslovně (by reference)**, ne převyprávěný rodičovským řetězcem |
| R4 kontrakty | Graf = volné JSONB, `node_type` text bez CHECK; jediná brána Zod v TS | Workflow grafy jsou kontrakty: verze v registru, validace proti `GraphNodeSchema`/`GraphEdgeSchema` při seed/load |
| R5 readback | Strom je čistá deliberace — bez side efektů | Readback až na hranici strom → `runtime_dispatch`/clow: vítězná větev prochází propose→confirm→execute (IP-8) |
| R6 lineage | `ai_workflow_node_runs` audituje uzly; `parent` hrana existuje | `parent` = nativní causation řetěz; doplnit `intent_id` kotvu → každá vítězná **i prořezaná** větev dohledatelná k zadání |
| R7 verifikace | Evaluace jen vůči rodiči/lokálnímu kontextu | Vítězná větev se verifikuje proti **root intentu**, ne rodičovským myšlenkám; metrika drift-per-depth; prune i na drift, nejen na score |

### 4.4 Fleet a clow — dělba kontraktů

Fleet mód (dirigent-run ↔ podstromové runy přes batch suspend/resume) je mezi-runová komunikace = plné envelope území; navrhuji ho jako **prvního adoptera ACS** na mezi-runové vrstvě — vzniká nově, takže nemá migrační zátěž. Dělba: **clow = kontrakt výkonu** (co a čím se vykoná), **ACS = kontrakt komunikace** (jak se sdělení přenáší a ověřuje). ACS envelope obaluje clow dispatch, nekonkuruje mu.

---

## 5. Plán vývoje

Strategie nasazení: **shadow → warn → enforce** per message typ, vše za feature flagy. Pořadí fází je záměrné: nejdřív viditelnost (F1), pak tvrdost (F2–F3), pak sémantika (F4–F5), pak bezpečnost a důkaz (F6–F7). Každá fáze má samostatnou hodnotu a rollback.

### F0 — Rozhodnutí a inventura (3–5 dní)

| | |
|---|---|
| Obsah | ADR: JSON Schema 2020-12 + ajv jako runtime, zod jako autorský DX layer (zod-to-json-schema); ULID pro ID; Ed25519 podpisy. Inventura všech inter-service message flows (vč. svc-communications, svc-source-broker, ws-gateway) s frekvencemi |
| Deliverables | `docs/adr/ADR-0xx-acs.md` (nový adresář), tabulka flows |
| Akceptace | Schválený ADR; kompletní seznam message typů s prioritou migrace |

### F1 — Envelope + audit v shadow režimu (1–2 týdny)

| | |
|---|---|
| Obsah | `packages/acs-sdk` (envelope builder, ULID, podpis — zatím jen počítán); `acs_message_log`; integrace IP-2 (svc-ai-chat outbound) a IP-4 (event-worker inbound, jen logování) |
| Deliverables | SDK + shadow log, dashboard korelačních řetězců |
| Akceptace | 100 % zpráv v shadow logu s korelací; overhead < 10 ms P95; **plná test suite zelená (No Regressions)** |
| Rollback | Flag off → SDK je pass-through |

### F2 — Contract registry, validace, DLQ (2 týdny)

| | |
|---|---|
| Obsah | `acs_message_schemas` + seed top-10 typů (vč. workflow graph definic, §4); `validate_message_envelope()` PG funkce + granty (IP-3); `acs_dead_letters` + alerting; codegen typů do `packages/acs-contracts` (IP-5, rozšíření gen:ide / db:types:gen); CI schema-diff detektor (IP-10) |
| Deliverables | Registry, DLQ s alertingem, generované typy, CI gate |
| Akceptace | Top-10 typů v enforce s DLQ rate < 0,5 %; breaking-change check blokuje merge |
| Riziko | Legitimní provoz padá do DLQ → warn okno min. 1 týden s metrikou před každým enforce |

### F3 — Structured generation na LLM hranici (2 týdny, paralelně s F2)

| | |
|---|---|
| Obsah | IP-1 v `llmRouter.ts`: schema-constrained mode per provider (JSON mode / tool-calling), validate-before-return, bounded retry (max 2), eskalace do `malformed_generations`; ESLint ban přímých provider importů |
| Deliverables | Router s vynucením R1 — nevalidní sdělení nevznikne |
| Akceptace | First-try validity > 95 %, po retry > 99,5 %; token/task metrika před/po zaznamenána |

### F4 — Intent store + pass-by-reference (2 týdny)

| | |
|---|---|
| Obsah | `acs_intents` + canonicalizace na ingressu (IP-6, `chat.ts` + gateway); `intent_id` povinné v envelope (warn → enforce); derivation marking v toolExecutor (IP-7); migrace `ai_runs`/`ai_trace_events` na intent kotvy |
| Deliverables | Immutable intent store, provenance na odvozeninách |
| Akceptace | 100 % nových zpráv nese `intent_id`; **telephone-game test:** 5-hop řetězec v CI, výstup verifikován proti intentu, 0 sémantických ztrát na testovací sadě |

### F5 — Readback / effect guard (1–2 týdny)

| | |
|---|---|
| Obsah | IP-8 v `toolExecutor.execute()`: whitelist side-effectful typů, `acs_pending_effects`, propose → strojové porovnání s intent constraints (limity, cílové entity, rozsahy — bez LLM-judge kde to jde) → confirm → execute; abort path |
| Deliverables | Effect guard pro write/delete/payment/deploy operace |
| Akceptace | 100 % whitelistovaných efektů přes readback; P95 overhead < 1 s; abort testován |
| Rollback | Prázdný whitelist |

### F6 — Verifier, ACL, podpisy enforce (2 týdny, částečně paralelně s F5)

| | |
|---|---|
| Obsah | `acs_agent_acl` default deny (IP-4); Ed25519 enforce (dosud shadow); verifier hook Dirigenta (IP-9): nezávislé porovnání výstupu s kanonickým intentem, sampling 100 % efekty / 10 % read-only |
| Deliverables | Podepsaná a autorizovaná komunikace, verifier v provozu |
| Akceptace | Spoofing/replay testy: nepodepsaná či neautorizovaná zpráva nedoručena; verifier odhalí zaseté chyby (mutation testing) |

### F7 — Observabilita, adversarial testy, governance (1–2 týdny)

| | |
|---|---|
| Obsah | Dashboard: validity rate, DLQ rate, drift incidenty, token/task, latence/hop (kotvy do OTel/Langfuse); adversarial sada v CI (§7); governance proces (§8) |
| Deliverables | Provozní dashboard, CI adversarial gate, governance dokument |
| Akceptace | Adversarial sada zelená; governance schválena |

**ToT stopa napříč fázemi (§4):** F2 — registry pokrývá i workflow grafy (validace graph definic při seed/load); F3 — structured generation platí i pro `tot_expand`/`tot_evaluate` (IP-11: Zod před merge do state); F4 — `intent_id` jako root ToT stromu, expanze by-reference, `ThoughtNode.intent_id`; F5 — readback na hranici vítězná větev → `runtime_dispatch`; F6 — verifier s metrikou drift-per-depth; fleet mód (až vznikne) startuje rovnou na ACS envelope.

**Harmonogram:** sekvenčně ~11–13 týdnů; s paralelizací (F3‖F2, F5‖F6) realisticky **8–10 týdnů**. ToT položky nejsou fáze navíc — jsou zapuštěné do F2–F6.

---

## 6. Metriky úspěchu (definition of done)

| Metrika | Cíl |
|---------|-----|
| First-try schema validity (LLM generace) | > 95 % (po retry > 99,5 %) |
| DLQ rate steady-state | < 0,5 % |
| Zprávy s `intent_id` lineage | 100 % |
| Latence overhead / hop (bez readbacku) | < 10 ms P95 |
| Readback overhead | < 1 s P95 |
| Telephone-game CI test (5 hopů) | 0 sémantických odchylek na sadě |
| Injection testy | 0 řídicích průniků z NL payloadu |
| Token/task vs baseline | ≥ 0 % (očekáváno −20 až −40 %) |

## 7. Testovací strategie

Kontraktní testy per message typ (happy path + edge cases, dle „Test All New Code"). Property-based fuzzing validátorů (fast-check). Adversarial korpus: prompt injection v NL payloadech včetně obsahu z BYOD zdrojů — cíl: pokus o zápis do řídicí roviny musí selhat. Telephone-game regression: syntetický 5-hop scénář s verifikací proti intentu. Replay/spoofing testy podpisů a dedup. Determinismus (dle „Stable Tests"): LLM mockován na hranici llmRouteru, validátory testovány čistě.

## 8. Governance

Registry má jednoho vlastníka. Nový message typ: návrh schématu + sémantiky → review → semver verze → codegen → shadow → warn → enforce. Aditivní změna = minor bez review; breaking = major s dual-run oknem obou verzí. Generované typy v `packages/acs-contracts` se needitují ručně (stejný princip jako auto-generovaný CLAUDE.md). Výjimka ze standardu = zápis do ADR s expirací, ne tichá obchůzka.

---

## Shrnutí v jedné větě

Vynucení žije v šesti neobejitelných chokepointech — LLM dispatch (vznik), ACS SDK (odeslání), PostgreSQL funkce + granty (transport), event-worker middleware (příjem), toolExecutor (efekty) a reflection node boundary (ToT deliberace) — takže „pochopení" zůstává mimo kritickou cestu a šum se nemá kde kumulovat: význam se nikdy nepřekódovává, jen odkazuje na immutable intent, a to i uvnitř myšlenkového stromu.
