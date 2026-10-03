# n8n AI Agent Architecture — AISHA Platform

> **Verze:** 2.1 | **Datum:** 2026-03
> **n8n instance:** https://n8n.aisha.guru/
> **MCP Server:** mcp-knowledge-server (Edge Function)

---

## Přehled

AISHA využívá **n8n AI Agent nodes** propojené s vlastním **MCP Knowledge Server** pro vytvoření autonomních agentů. n8n poskytuje dva klíčové agentní patterny:

| Pattern | n8n Node | AISHA využití |
|---------|----------|---------------|
| **Personal Agent** | `@n8n/n8n-nodes-langchain.agent` | Specializovaný AI agent s MCP tools + pamětí |
| **Workflow Agent** | `toolWorkflow` + `executeWorkflowTrigger` | Sub-workflow jako tool pro hlavního agenta |

### LLM Model Routing

Všichni agenti používají **AishaLlmRouter** (`n8n-nodes-aisha.aishaLlmRouter`) jako AI Language Model sub-node místo přímého připojení na konkrétního LLM poskytovatele. To umožňuje:

- **Automatický provider failover** — při chybě kvóty/billingu přepne na další provider bez přerušení agenta
- **Konfigurovatelné strategie** — `auto`, `explicit`
- **Centralizované credentials** — jedna konfigurace pro všechny agenty
- **Přidání poskytovatele** — editace jednoho node souboru bez změny workflowů

Výchozí strategie: `auto` — router detekuje dostupné API klíče a vybere prvního dostupného providera (priorita: Google → OpenAI → Anthropic). Ostatní dostupní provideři tvoří automatický fallback chain.
Dirigent Agent: `qualityFirst` strategie (preferuje providery s vyšší kvalitou pro orchestraci).

---

## Architektura

```
┌──────────────────────────────────────────────────────────────────────┐
│                      n8n @ n8n.aisha.guru                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  PERSONAL AGENTS (AI Agent + LLM + Memory + Tools)             │  │
│  │                                                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ Knowledge   │  │ Compliance  │  │  Delivery   │           │  │
│  │  │   Agent     │  │   Agent     │  │   Agent     │           │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │  │
│  │         │                │                │                   │  │
│  │  ┌──────┴────────────────┴────────────────┘                   │  │
│  │  │  ┌─────────────┐                                           │  │
│  │  │  │  Ragnarok   │                                           │  │
│  │  │  │    Agent    │                                           │  │
│  │  │  └──────┬──────┘                                           │  │
│  │  │         │                                                  │  │
│  │  │         ▼                                                  │  │
│  │  ┌───────────────────────────────────────────────────┐        │  │
│  │  │         MCP Client Tool (shared)                  │        │  │
│  │  │  → AISHA MCP Server (30+ tools)                   │        │  │
│  │  └───────────────────────┬───────────────────────────┘        │  │
│  └──────────────────────────┼────────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────┼────────────────────────────────────┐  │
│  │  DIRIGENT AGENT (Master Orchestrator)                         │  │
│  │                                                                │  │
│  │  AI Agent + MCP Tools + Workflow Agent Tools:                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │  │
│  │  │ PR Gate WF   │  │ Reroute WF   │  │ Audit WF     │        │  │
│  │  │ (sub-workflow)│  │ (sub-workflow)│  │ (sub-workflow)│        │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                         │ JSON-RPC 2.0 / MCP Streamable HTTP
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Supabase Edge Functions                                             │
│                                                                      │
│  ┌─────────────────────────────────────┐                            │
│  │ mcp-knowledge-server               │  ← n8n MCP Client target   │
│  │                                     │                            │
│  │ Knowledge:                          │                            │
│  │  search_knowledge(_v2)              │                            │
│  │  search_ragnarok  ← Elasticsearch   │                            │
│  │  get_expert_rule                    │                            │
│  │  get_expertise_areas                │                            │
│  │  match_experts                      │                            │
│  │  get_agent_knowledge                │                            │
│  │  get_project_context                │                            │
│  │  get_knowledge_stats                │                            │
│  │                                     │                            │
│  │ Delivery:                           │                            │
│  │  get_story_context                  │                            │
│  │  create_story_ruleset               │                            │
│  │  transition_delivery_status         │                            │
│  │  get_delivery_timeline              │                            │
│  │  get_allowed_transitions            │                            │
│  │  manage_story_environment           │                            │
│  │  get_story_environments             │                            │
│  │                                     │                            │
│  │ Router + Composer:                  │                            │
│  │  route_task                         │                            │
│  │  compose_context                    │                            │
│  │  validate_compliance                │                            │
│  │                                     │                            │
│  │ Dirigent:                           │                            │
│  │  moderate_flow                      │                            │
│  │  evaluate_tests                     │                            │
│  │  assess_quality                     │                            │
│  │  suggest_next_step                  │                            │
│  │  estimate_effort                    │                            │
│  │  check_pr_compliance                │                            │
│  │                                     │                            │
│  │ Meta:                               │                            │
│  │  generate_copilot_instructions      │                            │
│  └─────────────────┬───────────────────┘                            │
│                    │ RPC                                              │
│  ┌─────────────────▼───────────────────┐                            │
│  │ PostgreSQL + pgvector               │                            │
│  │ expert_rules │ ai_runs │ ai_trace   │                            │
│  │ agent_configurations │ stories      │                            │
│  └─────────────────────────────────────┘                            │
│                                                                      │
│  ┌─────────────────────────────────────┐                            │
│  │ Ragnarok / Alquist Insight (RAG)   │  ← ragnarok-search proxy   │
│  │  Elasticsearch (BM25 + KNN hybrid)  │                            │
│  │  Document upload + chunking         │                            │
│  │  Port: 9696 (API) / 9200 (ES)      │                            │
│  └─────────────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Katalog agentů

### 1. Knowledge Agent (`WF_KNOWLEDGE_AGENT`)

**Účel:** Expertní přístup ke znalostní bázi Guild of Experts. Vyhledává pravidla, matchuje experty, sestavuje projektový kontext.

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Webhook (API) + Chat trigger (interakce) |
| **LLM** | AishaLlmRouter (`auto` — vybere nejlepšího dostupného providera, ostatní jako fallback) |
| **Memory** | Buffer Window (posledních 10 zpráv) |
| **MCP Tools** | `search_knowledge`, `search_knowledge_v2`, `get_expert_rule`, `get_expertise_areas`, `match_experts`, `get_agent_knowledge`, `get_project_context`, `get_knowledge_stats` |
| **System prompt** | Jsi AISHA Knowledge Expert. Pomáháš najít relevantní pravidla a doporučení z Guild of Experts znalostní báze. |

**Příklady použití:**
- *"Najdi best practices pro implementaci RLS policies"*
- *"Kteří experti se specializují na longevity?"*
- *"Sestav kontext pro projekt XY"*

### 2. Compliance Agent (`WF_COMPLIANCE_AGENT`)

**Účel:** Autonomní compliance kontrola. Validuje PR, stories a kód proti compliance pravidlům. Může eskalovat nebo reroute.

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Webhook (GitHub bridge) + Manual (n8n-trigger) |
| **LLM** | AishaLlmRouter (`auto` — vybere nejlepšího dostupného providera, ostatní jako fallback) |
| **Memory** | Žádná (stateless per-request) |
| **MCP Tools** | `validate_compliance`, `check_pr_compliance`, `route_task`, `compose_context`, `get_story_context`, `create_story_ruleset` |
| **Workflow Tools** | PR Gate sub-workflow, Reroute sub-workflow |
| **System prompt** | Jsi AISHA Compliance Agent. Tvým úkolem je ověřit, že veškerý kód a delivery odpovídá pravidlům platformy. |

**Autonomní chování:**
- Při PR → kontroluje compliance → pass/fail + GitHub Check
- Při fail → spustí reroute workflow → re-check → eskalace
- Reasoning: vysvětlí proč compliance prošla/neprošla

### 3. Delivery Agent (`WF_DELIVERY_AGENT`)

**Účel:** Správa delivery lifecycle stories. Transitions stavů, environment management, timeline tracking.

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Webhook + Chat + Scheduled |
| **LLM** | AishaLlmRouter (`auto` — vybere nejlepšího dostupného providera, ostatní jako fallback) |
| **Memory** | Buffer Window (5 zpráv — delivery context) |
| **MCP Tools** | `transition_delivery_status`, `get_delivery_timeline`, `get_allowed_transitions`, `manage_story_environment`, `get_story_environments`, `get_story_context`, `estimate_effort` |
| **System prompt** | Jsi AISHA Delivery Agent. Spravuješ lifecycle stories od backlog po done. |

**Příklady použití:**
- *"Posuň story ABC do stavu in_review"*
- *"Ukaž timeline story XYZ"*
- *"Nastav staging environment pro story ABC"*

### 4. Dirigent Agent (`WF_DIRIGENT_AGENT`) — Master Orchestrator

**Účel:** Koordinátor všech AI agentů. Může delegovat na sub-workflow agenty, moderovat dev flow, hodnotit kvalitu.

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Chat (hlavní rozhraní) + Webhook (integrace) |
| **LLM** | AishaLlmRouter — `qualityFirst` strategie (preferuje providery s vyšší kvalitou, ostatní jako fallback) |
| **Memory** | Buffer Window (20 zpráv) |
| **MCP Tools** | Všechny Dirigent tools + Knowledge tools |
| **Workflow Tools** | Knowledge Agent, Compliance Agent, Delivery Agent (jako sub-workflows) |
| **System prompt** | Jsi AISHA Dirigent — AI koordinátor celé platformy. Máš k dispozici specializované agenty které můžeš delegovat. |

**Klíčová schopnost:** Dirigent je **orchestrátor agentů**. Používá Workflow Agent Tools k delegaci na specializované agenty:

```
User: "Zkontroluj PR #42 a pokud projde, posuň story do review"

Dirigent reasoning:
  1. Zavolám Compliance Agent → zkontroluje PR
  2. Pokud pass → zavolám Delivery Agent → transition to in_review
  3. Informuji uživatele o výsledku
```

### 5. Ragnarok Agent (`WF_RAGNAROK_AGENT`)

**Účel:** RAG agent pro dotazování nad dokumenty nahranými do Ragnarok knowledge base. Využívá dual KB strategii — primárně Elasticsearch hybrid search, fallback na pgvector.

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Webhook (path: `ragnarok-agent`) |
| **LLM** | AishaLlmRouter (`auto` — vybere nejlepšího dostupného providera, ostatní jako fallback) |
| **Memory** | Buffer Window (session key) |
| **MCP Tools** | `search_ragnarok` (Elasticsearch hybrid BM25+KNN), `search_knowledge_v2` (pgvector fallback) |
| **System prompt** | Dual KB strategie: nejprve hledej v Ragnarok KB, pokud nenajdeš → pgvector. Cituj zdroje. |

**Dual KB strategie:**
- **Primární:** `search_ragnarok` — Elasticsearch hybrid search nad nahranými dokumenty (PDF, DOCX, TXT, MD, CSV)
- **Fallback:** `search_knowledge_v2` — pgvector sémantické vyhledávání v knowledge_items
- Agent automaticky volí zdroj podle typu dotazu a dostupnosti výsledků

**Příklady použití:**
- *"Co říká protokol o dávkování vitamínu D?"*
- *"Shrň hlavní body z nahraného dokumentu XY"*
- *"Najdi doporučení pro suplementaci v dokumentech"*

### 6. Maestro Dialog Agent (`WF_MAESTRO_DIALOG_AGENT`)

**Účel:** Service-role-only proxy na Maestro dialog management API (Alquist Insight). Multi-turn coherence vrstva (Alexa Prize USP) pro story konzultace a asistovanou delivery.

⚠️ **Standardní cesta z frontendu je `services/svc-ai-chat /story-consult`** — ten aplikuje plný brain wiring (Tao + Psyche + Hippocampus + governance + compose_context). Tento workflow je **low-level proxy** pouze pro service-role klienty (n8n agenty, sandbox testy v WF_SELF_LEARNING_LOOP).

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Webhook (path: `maestro-dialog`, service-role only) |
| **LLM** | Maestro vlastní (interní OpenAI/vLLM, INSIGHT_LLM_BACKEND toggle) |
| **Memory** | Multi-turn history v body (`history: [{role, content}, …]`) |
| **MCP Routes** | Volá `/maestro/chat` přes svc-mcp-knowledge (service-role JWT) |
| **System prompt** | Dorazí z volajícího (assembled brain layer); Maestro sám prompt nepostavuje |

**Project ID convention:**
- `aisha` — global default
- `story-{uuid}` — per-story KB filter (Ragnarok kb_ids namespace)
- `sandbox-{run_id}` — izolovaná sandbox session pro WF_SELF_LEARNING_LOOP experimenty

**Brain layer integrace:**
- AISHA `compose_context` RPC vrací 4 vrstvy (governance/psyche/kb_retrieval/project)
- `orchestrationBridge.enrichWithAishaContext` mergeuje pgvector + Ragnarok hybrid (per-story `kb_ids`)
- `hippocampus.searchPersonalityContext` přidá per-user evolved traits
- `governedOrchestration.resolveGovernanceDecision` aplikuje Tao constraints
- Assembled prompt předán Maestrovi přes `system_prompt` field

**Příklady použití (service-role):**
- WF_INSIGHT_DIALOG_EVAL: ověření multi-turn coherence + governance compliance
- Sandbox experimenty s novými prompty před promote do produkce

### 7. Insight Dialog Eval (`WF_INSIGHT_DIALOG_EVAL`)

**Účel:** Cron-driven evaluator USP integrity — měří multi-turn coherence, retrieval recall, governance compliance v Maestro dialozích za poslední okno (default 6h). Při alertu vytvoří `improvement_proposal` pro WF_SELF_LEARNING_LOOP.

| Vlastnost | Hodnota |
|-----------|---------|
| **Trigger** | Schedule (každých 6h) |
| **Data source** | Langfuse traces (filter `tags=insight,maestro`) |
| **Metrics** | coherence_ratio, retrieval_ratio, governance_ratio, context_enabled_false count |
| **Thresholds** | coherence < 70% → high alert; governance < 90% → critical; context_enabled=false → critical |
| **Outcome** | `fn_create_improvement_proposal` RPC (nizký risk → auto-approval, jinak manual review) |

**Doplňuje** [WF_LANGFUSE_PERFORMANCE_REVIEW](../n8n/workflows/WF_LANGFUSE_PERFORMANCE_REVIEW.json) (denní generic review) — toto je Insight-specific eval na úrovni Maestro/Ragnarok dialogů.

---

## Autonomní orchestrační protokol (v1.0)

> **Nasazeno:** 2026-06 | Prompty v `n8n/workflows/WF_*_AGENT.json`

### Princip

Agenti nejsou chatboti — jsou to **autonomní rozhodovací systémy**. Dirigent přijímá signály ze subsystémů (Knowledge, Compliance, Delivery) a na základě signálové matice spouští playbooks.

### Signálový protokol

Každý subsystémový agent vrací Dirigentovi **strukturovaný signál**:

```
Compliance Agent → { signal: "compliance_result", verdict: "pass|fail|escalate", severity, violations[] }
Delivery Agent   → { signal: "delivery_result", result: "success|blocked|stuck", days_in_status, is_stuck }
Knowledge Agent  → { signal: "knowledge_result", has_knowledge_gap, gap_topic, results[] }
Ragnarok Agent   → { signal: "ragnarok_result", source: "ragnarok|pgvector", chunks_found, has_answer }
```

### Signálová matice Dirigenta

| Signál v requestu | Reakce Dirigenta |
|---|---|
| `action: 'story_created'` + `story_id` | Onboarding playbook: analyze → match → scaffold |
| `action: 'pr_opened'` + `pr_number` | Deleguj Compliance Agent |
| Compliance vrátí `verdict: 'fail'` | Enforcement playbook: block → notify → fix |
| `action: 'escalation'` + `severity` | Triage podle severity level |
| `action: 'nightly_audit_result'` | Audit response playbook |
| `action: 'stuck_story'` + `story_id` | Deblokace playbook |

### Úrovně autonomie

| Level | Pravidlo | Příklady |
|-------|----------|----------|
| **LOW** | Jednej autonomně, loguj | Knowledge lookup, context compose |
| **MEDIUM** | Jednej + informuj | Story transition, environment setup |
| **HIGH** | Navrhni + čekej na schválení | Compliance enforcement, blocking |
| **CRITICAL** | Stop + eskaluj na člověka | Bezpečnostní incident, data breach |

### Playbooks (5)

1. **Onboarding story** — Story created → get_story_context → match_experts → scaffold → generate_copilot_instructions
2. **PR Compliance Gate** — PR opened → delegate Compliance → verdict → GitHub Check
3. **Compliance Enforcement** — Violation found → classify severity → block/fix/warn
4. **Audit Response** — Nightly audit results → triage → remediation plan
5. **Deblokace stuck story** — Story stuck >5 days → diagnose → suggest unblock

### Developer Tools

```bash
npm run aisha:prompts:deploy     # Deploy system prompts to n8n
npm run aisha:prompts:diff       # Show diff without deploying
npm run aisha:tools:deploy       # Deploy toolCode nodes
npm run aisha:tools:status       # Check tool status
npm run aisha:workflows:sync     # Sync local JSONs from server
```

---

## n8n Node Mapping

### AI Agent Node (`@n8n/n8n-nodes-langchain.agent`)

Každý Personal Agent používá:

```
AI Agent
 ├── LLM: OpenAI Chat Model (`@n8n/n8n-nodes-langchain.lmChatOpenAi`)
 ├── Memory: Buffer Window (`@n8n/n8n-nodes-langchain.memoryBufferWindow`)
 └── Tools:
      ├── MCP Client Tool (`@n8n/n8n-nodes-langchain.toolMcp`)
      │   └── URL: <AISHA_POSTGREST_URL>/functions/v1/mcp-knowledge-server
      │       Headers: Authorization=Bearer <MCP_TOKEN>
      ├── Workflow Tool (`@n8n/n8n-nodes-langchain.toolWorkflow`)
      │   └── Sub-workflow: WF_PR_COMPLIANCE_GATE
      └── HTTP Request Tool (`@n8n/n8n-nodes-langchain.toolHttpRequest`)
          └── Supabase RPC calls
```

### MCP Client Configuration

```json
{
  "connectionType": "sse",
  "sseUrl": "{{ $env.AISHA_POSTGREST_URL }}/functions/v1/mcp-knowledge-server",
  "authentication": "genericCredentialType",
  "genericAuthType": "httpHeaderAuth",
  "headers": {
    "Authorization": "Bearer {{ $env.MCP_TOKEN }}",
    "Content-Type": "application/json"
  }
}
```

> **Poznámka:** AISHA MCP server implementuje **Streamable HTTP** transport (POST + JSON-RPC 2.0), ne SSE. n8n MCP Client musí být nastaven v HTTP mode.

### Workflow Agent Tool Pattern

Existující workflows (PR Gate, Reroute, Audit) se stávají **tools pro Dirigent Agent**:

```
┌─────────────────────────────────────────────────────┐
│ Dirigent Agent                                       │
│                                                      │
│  Tool: "compliance_check"                            │
│   → Execute Workflow: WF_PR_COMPLIANCE_GATE          │
│   → Input: { pr_number, repo, head_sha }             │
│   → Output: { pass: true/false, summary }            │
│                                                      │
│  Tool: "run_nightly_audit"                           │
│   → Execute Workflow: WF_NIGHTLY_STORY_AUDIT         │
│   → Input: {}                                        │
│   → Output: { stories_checked, violations }          │
│                                                      │
│  Tool: "reroute_violation"                           │
│   → Execute Workflow: WF_COMPLIANCE_REROUTE          │
│   → Input: { story_id, violations }                  │
│   → Output: { resolved: true/false }                 │
└─────────────────────────────────────────────────────┘
```

---

## MCP Server — Propojení s n8n

### Autentizace

MCP server validuje tokeny přes `validate_mcp_token` RPC:

```
n8n request:
  POST /functions/v1/mcp-knowledge-server
  Authorization: Bearer mcp_xxx...
  Content-Type: application/json

  {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

### Dostupné MCP operace

| MCP Method | Popis |
|------------|-------|
| `initialize` | Handshake — server info + capabilities |
| `tools/list` | Seznam všech dostupných tools |
| `tools/call` | Zavolat konkrétní tool s argumenty |
| `resources/list` | Seznam resources (overview) |
| `resources/read` | Přečíst resource |
| `prompts/list` | Seznam prompt templates |
| `prompts/get` | Získat prompt template |

### Tool Permission Model

Každý MCP tool má definovaný **access tier**. n8n agenti typicky mají elevated access (service role), ale pro user-facing agenty se respektuje user's access tier:

| Agent | Auth mode | Access level |
|-------|-----------|--------------|
| Knowledge Agent | MCP Token (service) | Plný read |
| Compliance Agent | MCP Token (service) | Plný read + write (compliance) |
| Delivery Agent | MCP Token (service) | Read + delivery transitions |
| Dirigent Agent | MCP Token (service) | Plný přístup |
| User-facing chat | User JWT | Omezený dle access tier |

---

## Phased Rollout

### Phase A: Základní agenti (teď)

1. ✅ MCP Server existuje s 30+ tools
2. → Vytvořit n8n workflow templates pro 4 agenty
3. → Importovat do n8n.aisha.guru
4. → Nakonfigurovat MCP credentials
5. → Otestovat Knowledge Agent (nejnižší riziko)

### Phase B: Workflow Agent integrace (týden 2)

1. Refaktorovat stávající workflows (PR Gate, Reroute, Audit) na sub-workflow pattern
2. Připojit jako Workflow Agent Tools k Dirigent Agentovi
3. Chat interface pro Dirigenta v n8n

### Phase C: Autonomous agents (týden 3-4)

1. Scheduled triggers pro Delivery Agent (denní status check)
2. Event-driven triggers pro Compliance Agent (PR webhooks → agent reasoning)
3. Dirigent jako centrální orchestrátor s delegací

### Phase D: Memory & Learning (měsíc 2+)

1. Persistent memory pro Dirigent Agent (cross-session)
2. Evaluation pipeline pro měření kvality agentů
3. User-specific context v Knowledge Agent

---

## Konfigurace v n8n

### Environment Variables (n8n.aisha.guru Settings → Variables)

| Variable | Hodnota | Popis |
|----------|---------|-------|
| `AISHA_POSTGREST_URL` | `https://<ref>.supabase.co` | Supabase project URL |
| `MCP_TOKEN` | `mcp_xxx...` | MCP auth token |
| `OPENAI_API_KEY` | `sk-...` | Pro AI Agent LLM |

### Credentials

| Credential name | Typ | Použití |
|-----------------|-----|---------|
| `Supabase Service Role` | HTTP Header Auth | RPC calls |
| `GitHub Token` | HTTP Header Auth | PR operations |
| `OpenAI API` | OpenAI credential | AI Agent LLM |
| `AISHA MCP` | HTTP Header Auth | MCP Server auth |

---

## Bezpečnostní invarianty

1. **MCP Token rotation:** Tokeny se rotují měsíčně přes `create_mcp_token` RPC
2. **Audit trail:** Každé MCP tool volání je logováno v `ai_trace_events`
3. **No PHI in agent memory:** n8n Buffer Window NESMÍ ukládat zdravotní data
4. **Guardrails:** Compliance Agent NEMŮŽE merge PR — pouze nastavit GitHub Check status
5. **Rate limiting:** MCP server respektuje `api_rate_limits` per token
6. **SECURITY DEFINER:** Všechny MCP-server RPC funkce mají `SET search_path TO 'public'`

---

## Metriky úspěchu

| Metrika | Cíl | Měření |
|---------|-----|--------|
| Compliance gate accuracy | >95% | poměr manual override vs. auto-pass |
| Knowledge search relevance | >80% | user rating na výsledcích |
| Delivery transition time | -50% | průměrný čas od ready → in_review |
| Agent response latency | <5s | p95 z ai_trace_events |
| False escalation rate | <10% | zbytečné eskalace na Dirigenta |

---

*Pro detaily implementace jednotlivých workflows viz `n8n/workflows/WF_*_AGENT.json`.*
*Pro MCP server tools viz `supabase/functions/mcp-knowledge-server/index.ts`.*
*Pro community nodes viz `docs/N8N_COMMUNITY_NODES.md` a `packages/n8n-nodes-aisha/`.*

---

## Custom Community Nodes (`n8n-nodes-aisha`)

> Detailní dokumentace: [N8N_COMMUNITY_NODES.md](N8N_COMMUNITY_NODES.md)

### Integrace do architektury

Community nodes rozšiřují existující agenturní ekosystém o typované, testované nody:

```
┌────────────────────────────────────────────────────────────────────┐
│  n8n @ n8n.aisha.guru                                               │
│                                                                    │
│  ┌──────────────────────────── Agents ──────────────────────────┐  │
│  │  Knowledge │ Compliance │ Delivery │ Dirigent                │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│                         │                                          │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │  n8n-nodes-aisha (Community Package)                         │  │
│  │  ┌──────────┐ ┌─────────┐ ┌──────────────┐ ┌─────────────┐  │  │
│  │  │AishaRpc  │ │AishaAudit│ │AishaStoryMgr│ │ModelRouter  │  │  │
│  │  └──────────┘ └─────────┘ └──────────────┘ └─────────────┘  │  │
│  │  ┌──────────────┐ ┌────────────────────────────────────────┐ │  │
│  │  │AishaTrigger  │ │AishaNodeFactory (Self-Orchestration)  │ │  │
│  │  └──────────────┘ └────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  WF_NODE_FACTORY (Self-orchestration workflow)               │  │
│  │  Cron + Webhook → Generate → Validate → Test → Register     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### Node Mapping — Rozšíření

| Stávající pattern | Community node alternativa | Výhoda |
|---|---|---|
| 31× `toolCode` s HTTP fetch | `AishaRpc` | Dropdown pro 26+ RPC, validace, audit headers |
| Manuální `httpRequest` pro audit | `AishaAudit` | 15 předdefinovaných akcí, auto workflow context |
| Code node s routing logikou | `AishaModelRouter` | 4 výstupy, risk matrix, DB overrides |
| Scheduled `httpRequest` polling | `AishaTrigger` | Deduplikace, 8 event typů, filtry |
| Manuální story management | `AishaStoryManager` | 8 typovaných operací |

### Playbook 6: Self-Orchestration (Node Factory)

```
Dirigent identifikuje chybějící tool
  → POST /webhook/node-factory { nodeName, operations, rpcFunctions }
  → WF_NODE_FACTORY: Generate → Validate → Test → Register
  → Audit log: NODE_FACTORY_SUCCESS
  → Developer review → npm run deploy:n8n
```

**Autonomní level:** MEDIUM — Generuje + validuje automaticky, deploy vyžaduje human review.

---

## Troubleshooting

### Webhooky vrací 404

Pokud **všechny** webhooky vrací 404, jde o problém na úrovni n8n serveru.
Viz **[docs/deploy/N8N_WEBHOOK_FIX.md](../deploy/N8N_WEBHOOK_FIX.md)** pro kompletní diagnostiku a postup opravy.

Rychlá diagnostika:
```bash
npm run aisha:webhooks:test
```
