## Plan: AISHA Orchestrace — Multi-model routing + n8n + IDE

### Vize: Autonomní orchestrace vývoje od myšlenky po deploy

AISHA není chatbot ani izolovaný nástroj. Je to **autonomní orchestrační systém celého vývojového cyklu** — od prvotní myšlenky přes analýzu, implementaci, review až po deploy. Zároveň funguje jako **průtokač (moderátor toku)**, který:

- **Řídí** co se děje, v jakém pořadí, s jakým modelem a jakou expertizou
- **Moderuje** práci uživatele v kontextu toho, co zrovna dělá (story, PR, úkol)
- **Poskytuje expertizu** platformy — Guild of Experts knowledge base se injektuje do každé interakce
- **Rozhoduje autonomně** — deleguje na sub-agenty, vyhodnocuje výsledky, iteruje dokud není hotovo

```
MYŠLENKA ──→ ANALÝZA ──→ IMPLEMENTACE ──→ REVIEW ──→ DEPLOY
suggest_next   compose     moderate_flow   check_pr    transition
_step          _context    assess_quality  _compliance _delivery_status
estimate       match       evaluate_tests              manage_story
_effort        _experts                                _environment
    │             │              │              │            │
    └─────────────┴──────────────┴──────────────┴────────────┘
                         AISHA DIRIGENT
                   moderuje tok celého lifecycle
             s multi-model routing (OpenAI + Gemini)
          a expertizou Guild of Experts knowledge base
```

**3 roviny autonomie:**
1. **Tool-level** — 30+ MCP nástrojů pro atomické operace (search, validate, transition)
2. **Agent-level** — specializovaní sub-agenti (Knowledge, Compliance, Delivery) řeší celé domény
3. **Dirigent-level** — master orchestrátor řídí tok, deleguje, vyhodnocuje, iteruje (až 12 kroků za request)

**2 rovnocenné kanály interakce:**
- **IDE** (VS Code `@aisha` + jakýkoli MCP-kompatibilní editor) — pro přirozenou interakci při vývoji
- **n8n** (`n8n.aisha.guru`) — pro automatizované workflows, API triggery, scheduled tasks, admin UI

### Architektonický princip: MCP = stabilní tool vrstva, řízení je jinde

```
KONZUMENTI                 TOOL VRSTVA                  DATA VRSTVA
────────────               ───────────                  ───────────
n8n AI Agent ──┐
               │
VS Code ext  ──┼──→ MCP Knowledge Server (30+ tools) ──→ Supabase DB
               │    (Streamable HTTP, JSON-RPC 2.0)      (RPC funkce)
Claude/Cursor──┘    model-agnostické!                    route_task()
                                                         compose_context()
                                                         validate_compliance()
```

**MCP se kvůli multi-model routingu NEMĚNÍ.** MCP vystavuje nástroje — je jedno jaký LLM je volá.
Změny jdou do:
- **LLM vrstvy** (`_shared/llmRouter.ts`) — kdo volá jaký model
- **Orchestrační vrstvy** (n8n Dirigent) — kdo rozhoduje co se dělá
- **Routing vrstvy** (`route_task()` RPC) — jaký agent + model pro jaký task

### Bidirectional flow: AISHA Dirigent jako centrální mozek

```
Uživatel (IDE / admin UI / API / chat)
    │
    ▼
n8n-trigger edge function ──→ n8n.aisha.guru/webhook/dirigent-agent
                                         │
                          AISHA Dirigent (AI Agent, GPT-4o, Memory 20msg, max 12 iterací)
                          ├── MCP Tools (30+ nástrojů) ← přímý přístup
                          ├── Knowledge Agent (Workflow Tool) ← delegace
                          ├── Compliance Agent (Workflow Tool) ← delegace
                          ├── Delivery Agent (Workflow Tool) ← delegace
                          └── Nightly Audit (Workflow Tool) ← delegace
                                         │
                          Dirigent vyhodnotí odpověď:
                          ├─ Stačí → formát response → zpět volajícímu
                          ├─ Nestačí → další iterace (jiný tool/agent)
                          └─ Nejistota → zeptá se zpět (přes chat session)
                                         │
                                         ▼
                          Response + Log Trace (ai_trace_events)
```

**Dirigent řídí celý n8n workflow bidirectionally:**
- Každý konzument (IDE, UI, API) pošle request → Dirigent rozhodne co a jak udělat
- Dirigent může v 1 requestu provést až 12 iterací (tool calls + vyhodnocení)
- Sub-agenty vrací výsledky zpět Dirigentovi → Dirigent vyhodnotí a rozhodne o dalším kroku
- Session memory (20 msg) umožňuje multi-turn konverzace přes chat endpoint

---

### Implementační fáze

#### Fáze 1: LLM Router — provider abstrakce (základ všeho)

1. Vytvořit `supabase/functions/_shared/llmRouter.ts` — unified LLM interface
2. Přidat Google AI SDK do `_shared/deps.ts`
3. Nový env var: `GOOGLE_AI_API_KEY`
4. Refaktorovat `ai-chat/index.ts` na `unifiedChat()`

#### Fáze 2: n8n — Model Router workflow

5. `WF_MODEL_ROUTER.json` — route_task → switch provider → OpenAI/Gemini Agent
6. Aktualizace Dirigent workflow s Model Router jako Workflow Tool

#### Fáze 3: DB migrace — agent_catalog model_overrides

7. Migrace s multi-model seed daty pro agent_catalog

#### Fáze 4: System prompty pro n8n agenty

8. OpenAI Agent = AISHA Expert (compliance, reasoning, structured output)
9. Gemini Agent = AISHA Scout (knowledge search, rutina, velký kontext)

#### Fáze 5: VS Code extension — synchronizace s n8n

10. `callN8nAgent()` v mcp-client.ts
11. `/dirigent` slash command v participant.ts
12. Setting `aisha.dirigent.n8nTriggerUrl`

#### Fáze 6: Dokumentace chaining patterns

13. Sequential, Route & Switch, Pipeline patterny v N8N_SETUP.md

#### Fáze 7: Observabilita

14. Ověření provider tracking v trace events
15. Admin dashboard filtr na provider

---

### Decisions

- **Gemini pro knowledge/knihovník, OpenAI pro compliance/reasoning**
- **Provider resolve přes model string prefix** (ne dedicated DB sloupec)
- **n8n Model Router jako separátní workflow** (reusable)
- **VS Code `/dirigent` command jde přes n8n** (multi-step reasoning s memory)




# Plán: Aisha → Dirigent — Kompletní evoluce

## TL;DR

Dirigent **není nová entita** — je to Aisha upgradovaná na orchestrátora vývojového flow. Aktuální plán v dirigent-plugin.md přeskakuje kritický krok: **propojení produkční Aisha pipeline s Phase 3 infrastrukturou** (router, composer, MCP knowledge, n8n). Bez tohoto propojení by VS Code extension volala MCP tools, které Aisha sama nepoužívá — Dirigent by byl odpojený od vlastního backendu.

Plán má **5 fází** (ne 3 jako v původním dokumentu), protože musíme nejdřív přemostit starý a nový svět.

---

## Fáze 0: Bridge — Propojení Aisha s Phase 3

**Cíl:** ai-chat a ai-story-consult začnou používat router + composer + MCP knowledge. Stejná pipeline, ale pod kapotou řízená z DB.

**Kroky:**

1. **Tracer do ai-story-consult** — `ai-story-consult/index.ts` nemá `createTracer`. Přidat ho (ai-chat ho má od L211).

2. **RPC pro agent_configurations** — Dnes se čte přes `.from('agent_configurations').select(...)` (L402-L417). To porušuje RPC-only pattern z AGENTS.md. Vytvořit `get_active_agent_configs_for_edge` RPC.

3. **Context Composer integrace** — Místo inline-skládaného system promptu (L529-L539) volat `compose_context()` RPC přes `ai-context-composer`. To zajistí, že knowledge graph a story rulesets se dostanou do promptu.

4. **Router integrace** — Extrahovat classify → specialist dispatch logiku z ai-chat (L433-L520) do `route_task()` RPC přes `ai-router`. Agent catalog v DB nahradí hardcoded `getAgent('classify')`.

**Verifikace:** ai-chat a ai-story-consult fungují identicky, ale data tečou přes router+composer. Tracer zachycuje celou pipeline. Existující testy hooků prochází.

---

## Fáze 1: Dirigent Backend — Nové MCP nástroje

**Cíl:** Rozšířit MCP knowledge server o 6 Dirigent nástrojů. Odpovídá Phase A z dirigent-plugin.md, ale s úpravami reflektujícími bridge z Fáze 0.

**Kroky:**

1. **Migrace** — `moderation_sessions` + `moderation_decisions` tabulky + 4 RPC funkce (`moderate_development_flow`, `evaluate_test_strategy`, `assess_code_quality`, `estimate_effort`). Dle dirigent-plugin.md A1.

2. **6 Dirigent MCP tools v `registerTools()`** (z celkových 35) — `moderate_flow`, `evaluate_tests`, `assess_quality`, `suggest_next_step`, `estimate_effort`, `check_pr_compliance`. Dle dirigent-plugin.md A2.

3. **Dirigent agent do `agent_configurations`** (ne do `agent_catalog` — ten je pro routing pipeline, ne pro user-facing moderaci). Nový záznam s `agent_type: 'dirigent'`, `routing_category: null`, vlastní instructions pro flow moderaci.

4. **`dirigent_full` context profile** do `context_profiles` tabulky — 16K token budget, ruleset-first priority.

**Verifikace:** MCP tools volatelné přes `tools/call`, vracejí data z DB.

---

## Fáze 2: n8n Governor Deploy

**Cíl:** Nasadit n8n na Coolify a aktivovat 3 připravené workflow JSONy.

**Kroky:**

1. **n8n deploy na Coolify** dle `n8n/N8N_SETUP.md` — Queue mode (main + Redis + worker)
2. **Import 3 workflows** — WF_PR_COMPLIANCE_GATE, WF_NIGHTLY_STORY_AUDIT, WF_COMPLIANCE_REROUTE
3. **Credentials setup** — Supabase service role, GitHub PAT, MCP token
4. **GitHub webhook** — PR compliance gate na repo

**Verifikace:** PR compliance gate spustí check run na GitHub.

---

## Fáze 3: VS Code Extension

**Cíl:** `@aisha` chat participant jako tenký klient nad MCP tools z Fáze 1.

**Struktura:** Dle dirigent-plugin.md Phase B — `extensions/aisha-dirigent/` s participant.ts, mcp-client.ts, workspace.ts, story-context.ts, tree-view.ts, status-bar.ts.

**Slash commands:** `/test`, `/quality`, `/compliance`, `/estimate`, `/next`, `/instructions` — mapují na MCP tools.

**Flow moderace:** Automatické volání `moderate_flow` s workspace kontextem (tech stack, git diff, otevřené soubory, story context).

**Expertise level:** VS Code setting → ovlivňuje hloubku odpovědí (beginner: WHY, expert: terse).

**Verifikace:** `@aisha /test useHealthCheckIns` vrátí chain analýzu hook → RPC → permissions → table.

---

## Fáze 4: Story Delivery Engine + Integrace

**Cíl:** FINAL-DRAFT Phase 6 — Aisha/Dirigent řídí celý delivery cyklus story.

**Kroky:**

1. **Delivery state machine** — rozšíření `partner_stories.delivery_status` o plné stavy (checkout_requested → analyzing → ... → delivered)
2. **`story_environments` tabulka** — preview/staging/production URLs
3. **WF_STORY_SCAFFOLD n8n workflow** — GitHub create repo → copilot-instructions.md → Coolify deploy
4. **Guild expert matching** — WF_GUILD_STORYLOOP_MATCH_AND_ASSIGN
5. **Auto-sync copilot instructions** — file watcher v extension + `generate_copilot_instructions` MCP tool
6. **Tracing integrace** — Dirigent sessions zobrazitelné v Admin UI (AdminAiRuns / AdminAiRunDetail)

---

## Závislosti a pořadí

```
Fáze 0 (Bridge)           ← PREREKVIZITA pro vše
   │
   ├── Fáze 1 (MCP tools) ← závisí na bridge (tools volají compose_context)
   │       │
   │       ├── Fáze 2 (n8n) ← paralelní s Fází 3
   │       │
   │       └── Fáze 3 (VS Code Extension) ← závisí na MCP tools
   │               │
   │               └── Fáze 4 (Delivery Engine) ← závisí na extension + n8n
```

## Rozhodnutí (potvrzená)

| # | Rozhodnutí | Zdůvodnění |
|---|-----------|------------|
| 1 | Dirigent = upgradovaná Aisha, ne nová entita | User: "novy dirigent je stara aisha" |
| 2 | Bridge (Fáze 0) je prerekvizita | Bez propojení ai-chat s router+composer+MCP by Dirigent byl odpojený |
| 3 | Dirigent agent do `agent_configurations`, ne `agent_catalog` | `agent_configurations` je produkční tabulka s admin UI |
| 4 | n8n deploy je součást plánu | 3 workflow JSONy jsou připravené |
| 5 | Cross-cutting concern (Phase 3-7) | Dirigent prostupuje routerem, composerem, governorem, extension, delivery |
| 6 | Full scope, ne MVP | User potvrdil |
| 7 | `.from()` → RPC pro agent_configurations | Porušení RPC-only patternu, tech debt |

## Dva nepropojené světy (aktuální stav)

**Starý svět (produkce):**
- ai-chat (784 ř.) — classify → specialist → main → simplicity
- ai-story-consult (992 ř.) — 5 akcí (chat, recap, translate, recommend, analyze)
- agent_configurations v DB, 10 access tierů, PII masking

**Nový svět (Phase 3, nepropojeno):**
- ai-router → route_task() RPC → agent_catalog pipeline
- ai-context-composer → compose_context() RPC → 4-layer context
- mcp-knowledge-server → 9 tools, pgvector semantic search
- story_rulesets → expert_rules → knowledge_items → embeddings

**Fáze 0 tyto dva světy propojí.**

## Implementační progress (FINAL-DRAFT fáze) - REVIEW NEEDED

| Fáze | Stav | Popis |
|------|------|-------|
| Phase 0 MCP Foundation | ✅ | mcp-protocol.ts, pgvector, 5 RPC |
| Phase 1 Knowledge Graph | ✅ | knowledge_items/chunks/embeddings, 9 MCP tools |
| Phase 2 Story Delivery Context | ⚠️ | Migrace existuje, hooky/UI ne |
| Phase 3 Router + Composer | ⚠️ | Edge functions + DB existují, NEPROPOJENY s ai-chat |
| Phase 4 Quality Governor | ⚠️ | n8n JSONy existují, n8n nedeploynut |
| Phase 5 Entitlements | ❌ | Neimplementováno |
| Phase 6 Delivery Engine (Aisha=Dirigent) | ❌ | Neimplementováno |
| Phase 7 Guild Formalizace | ❌ | Neimplementováno |
