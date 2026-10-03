# AISHA AI — Roadmapa k autonomnímu agentnímu systému

> **Dokument:** Plan rozšíření ze současné custom pipeline na plnohodnotný, dynamicky skládaný a škálovatelný agentní systém.
> **Verze:** 1.0 | **Datum:** 2026-02-27
> **Stav:** Návrh k diskusi

---

## Výchozí stav (as-is)

AISHA dnes provozuje funkční **custom multi-agent pipeline** postavenou přímo na OpenAI Responses API v Deno edge funkcích. Architektura je:

```
User → classify → specialist (DB-driven routing) → main_agent (orchestrator) → [simplicity]
```

**Co funguje dobře:**
- DB-driven konfigurace agentů — live editace bez deploymentu
- Multi-tier guardrails (10 access tierů, PII masking, jailbreak detekce)
- Plná auditovatelnost přes `audit_journal` a `_audited` RPC pattern
- Verzovaná history konfigurací (`agent_configuration_history`)
- Story AI s kontextem zdravotních dat + konsentů
- Human-in-the-loop přes `message_escalations`

**Klíčové mezery:**
- Žádné persistentní metriky (tokeny, latence per step)
- Žádný evaluation systém — neměříme kvalitu odpovědí
- Tool calling je v DB jako JSONB, ale není zpracováno
- Agenti nemohou sami iniciovat akce (pouze reaktivní)
- Pouze OpenAI provider
- Lineární pipeline — žádná paralelizace, podmíněné větve, cykly

---

## Architektura cílového stavu

```
┌─────────────────────────────────────────────────────────────────────────┐
│  INTENT LAYER                                                           │
│  Planner Agent — dekompozice cíle na kroky, volba nástrojů, prioritizace│
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ plán (DAG kroků)
┌────────────────────────────────▼────────────────────────────────────────┐
│  EXECUTION LAYER — Dynamický graph executor                             │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Specialist A │  │ Specialist B │  │ Tool Worker  │  ← paralelně     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         └────────────┬────┘           │                                 │
│                      ▼                ▼                                 │
│              ┌───────────────────────────────┐                          │
│              │  Orchestrator / Aggregator    │                          │
│              └───────────────────┬───────────┘                          │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   │ výsledek / akce
┌──────────────────────────────────▼──────────────────────────────────────┐
│  MEMORY & STATE LAYER                                                   │
│  Working memory │ Long-term memory │ Checkpoint store │ Tool state      │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────┐
│  OBSERVABILITY LAYER                                                    │
│  Trace store │ Token metrics │ Quality scores │ Alerting                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Fáze 1 — Observabilita a metriky (měsíce 1–2)

> **Cíl:** Vidět co se děje. Bez měření nelze zlepšovat.

### 1.1 Persistentní trace log

**DB migrace:** Nová tabulka `ai_trace_events`

```sql
CREATE TABLE ai_trace_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id    uuid NOT NULL,           -- spojuje celý jeden request
  span_id     uuid NOT NULL,           -- jeden krok v pipelině
  parent_span_id uuid,                 -- parent krok (pro nested spany)
  conversation_id uuid,
  user_id     uuid REFERENCES auth.users(id),
  agent_name  text NOT NULL,           -- 'classify', 'specialist:rtn-produkce', ...
  step_index  int,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  duration_ms int GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000
  ) STORED,
  model       text,
  tokens_input  int,
  tokens_output int,
  status      text CHECK (status IN ('ok','error','timeout','skipped')),
  error_message text,
  metadata    jsonb DEFAULT '{}'
);
```

**Edge function změna:** Na konci každého kroku (`classify`, `specialist`, `main_agent`, `simplicity`) zapsat span do DB. Trace ID se generuje na začátku requestu a prochází celou pipeline.

**Admin UI:** Nový panel v `/admin/agents` — seznam posledních trace logs, detailní breakdown per request.

### 1.2 Agregované metriky (materialized view)

```sql
CREATE MATERIALIZED VIEW ai_agent_metrics_hourly AS
SELECT
  date_trunc('hour', started_at) AS hour,
  agent_name,
  model,
  COUNT(*)                        AS requests,
  AVG(duration_ms)                AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency_ms,
  SUM(tokens_input + tokens_output)  AS total_tokens,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
FROM ai_trace_events
GROUP BY 1, 2, 3;
```

Refresh každou hodinu přes pg_cron nebo trigger.

### 1.3 Frontend metrics dashboard

- Grafy latence per agent (recharts — already in app)  
- Token consumption timeline  
- Error rate alerts  
- Routing distribution (kolik % zpráv jde do každého specialisty)

**Odhad práce:** 3–4 dny backend + 2 dny frontend.

---

## Fáze 2 — Tool systém (měsíce 1–3)

> **Cíl:** Agenti mohou volat definované funkce (tools), nejen generovat text.

### 2.1 Tool Registry v DB

**DB migrace:** Tabulka `agent_tools` + vazba `agent_tool_bindings`

```sql
CREATE TABLE agent_tools (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text UNIQUE NOT NULL,  -- 'search_knowledge_base', 'get_lab_results', ...
  description  text NOT NULL,         -- popis pro LLM
  parameters_schema jsonb NOT NULL,   -- JSON Schema parametrů
  handler_type text NOT NULL          -- 'rpc' | 'edge_function' | 'webhook'
  handler_ref  text NOT NULL,         -- název RPC nebo edge funkce
  access_tier_min text DEFAULT 'basic',  -- minimální required access tier
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE agent_tool_bindings (
  agent_configuration_id uuid REFERENCES agent_configurations(id),
  tool_id                uuid REFERENCES agent_tools(id),
  PRIMARY KEY (agent_configuration_id, tool_id)
);
```

### 2.2 Tool Executor v edge funkci

```typescript
// _shared/toolExecutor.ts

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

async function executeToolCall(
  toolCall: ToolCall,
  supabaseUser: SupabaseClient,
  userId: string
): Promise<string> {
  // 1. Načti tool definici z DB
  const { data: tool } = await supabaseUser.rpc('get_agent_tool', {
    p_name: toolCall.name
  });
  
  // 2. Validuj argumenty proti JSON Schema
  validateArguments(toolCall.arguments, tool.parameters_schema);
  
  // 3. Dispatch podle handler_type
  if (tool.handler_type === 'rpc') {
    const { data } = await supabaseUser.rpc(tool.handler_ref, toolCall.arguments);
    return JSON.stringify(data);
  }
  if (tool.handler_type === 'edge_function') {
    const { data } = await supabaseUser.functions.invoke(tool.handler_ref, {
      body: toolCall.arguments
    });
    return JSON.stringify(data);
  }
  throw new Error(`Unknown handler type: ${tool.handler_type}`);
}
```

### 2.3 Tool call loop v ai-chat

Nahradit `openai.responses.create()` za iterativní smyčku:

```typescript
// Pseudo-kód tool call loop
let response = await openai.chat.completions.create({
  model: agent.model,
  messages: [...history, { role: 'user', content: message }],
  tools: agent.tools.map(toOpenAIToolSpec),
  tool_choice: 'auto',
});

while (response.choices[0].finish_reason === 'tool_calls') {
  const toolCalls = response.choices[0].message.tool_calls;
  const toolResults = await Promise.all(
    toolCalls.map(tc => executeToolCall(tc, supabaseUser, userId))
  );
  
  // Append tool results a pokračuj
  messages.push(response.choices[0].message);
  toolCalls.forEach((tc, i) => messages.push({
    role: 'tool',
    tool_call_id: tc.id,
    content: toolResults[i],
  }));
  
  response = await openai.chat.completions.create({ ... });
  maxIterations--;
}
```

### 2.4 Prioritní sada toolů (první vlna)

| Tool | Handler | Popis |
|------|---------|-------|
| `search_knowledge_base` | RPC `get_knowledge_topics_localized` | Prohledání znalostní báze |
| `get_my_lab_results` | RPC `get_my_lab_results_audited` | Výsledky laboratorních testů |
| `get_longevity_score` | RPC `get_longevity_score_audited` | Longevity skóre uživatele |
| `get_study_info` | RPC `get_study_detail` | Detail studie |
| `create_reminder` | RPC `create_story_reminder_audited` | Vytvoření připomínky |
| `get_dosage_plan` | RPC `get_my_dosage_plans` | Aktuální plán dávkování |

**Odhad práce:** 5–7 dní backend + 2 dny admin UI (vazba tool ↔ agent).

---

## Fáze 3 — Evaluace kvality (měsíce 2–4)

> **Cíl:** Měřit relevanci, správnost a bezpečnost odpovědí. Bez toho jsou instrukce psány poslepu.

### 3.1 Evaluation dataset

Každá uložená konverzace je potenciální evaluační případ. Přidáme:

- **Uživatelský feedback**: Thumbs up/down tlačítka pod každou AI zprávou
- **Admin rating**: V admin chat logu možnost označit odpověď jako `correct/incorrect/harmful`

DB rozšíření tabulky `chat_messages`:
```sql
ALTER TABLE chat_messages ADD COLUMN user_rating smallint CHECK (user_rating IN (-1, 0, 1));
ALTER TABLE chat_messages ADD COLUMN admin_rating smallint CHECK (admin_rating IN (-1, 0, 1));
ALTER TABLE chat_messages ADD COLUMN admin_review_note text;
```

### 3.2 Automatická evaluace (LLM-as-judge)

**Nová edge funkce** `evaluate-ai-response`:

```typescript
interface EvalResult {
  conversation_id: string;
  message_id: string;
  relevance_score:    number;  // 0–1: jak relevantní je odpověď k otázce
  groundedness_score: number;  // 0–1: odpověď vychází z dostupného kontextu
  safety_score:       number;  // 0–1: absence škodlivého obsahu
  coherence_score:    number;  // 0–1: logická konzistence
  overall_score:      number;  // průměr
  reasoning:          string;  // vysvětlení skóre
}
```

Evaluátor = levný model (gpt-5-mini) s strukturovaným výstupem JSON, volaný asynchronně po každé odpovědi.

### 3.3 Regression testing

Při změně instrukcí agenta spustit sadu "golden examples" (z admin UI označené jako referenční) a porovnat skóre před/po. Blokovat deployment pokud `overall_score` klesne > 10%.

**Workflow:**
```
Admin uloží nové instrukce 
  → DB trigger → enqueue evaluation job 
  → evaluate-ai-response edge funkce spustí golden set 
  → výsledky uloží do ai_eval_runs 
  → admin vidí report v /admin/agents → [Schválit / Vrátit zpět]
```

**Odhad práce:** 4–5 dní.

---

## Fáze 4 — Agentní smyčka a paměť (měsíce 3–6)

> **Cíl:** Agent může plánovat, iterovat a "pamatovat si" kontext přes sessions.

### 4.1 ReAct smyčka (Reason → Act → Observe)

Současná pipeline je jednoduchá jednokolová. ReAct pattern umožňuje:

```
THOUGHT: "Uživatel se ptá na longevity skóre. Musím nejdřív zjistit jeho data."
ACTION: call_tool(get_longevity_score, { user_id })
OBSERVATION: { score: 72, trend: "improving", weak_areas: ["sleep", "stress"] }
THOUGHT: "Teď vím skóre. Podívám se na konkrétní doporučení pro sleep."
ACTION: call_tool(search_knowledge_base, { query: "sleep optimization" })
OBSERVATION: [relevantní articles]
THOUGHT: "Mám dostatek kontextu. Odpovím s personalizovaným doporučením."
RESPONSE: "Tvoje longevity skóre je 72..."
```

**Implementace:** Iterativní tool call loop (Fáze 2) + `max_iterations` limit (bezpečnostní pojistka) + ukládání intermediate steps do trace.

### 4.2 Pracovní paměť (session-scoped)

Kontext, který agent potřebuje v rámci jedné session, ale nechceme ho posílat v každém requestu:

```sql
CREATE TABLE ai_session_memory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  key             text NOT NULL,  -- 'user_profile_summary', 'last_lab_context', ...
  value           jsonb NOT NULL,
  expires_at      timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(conversation_id, key)
);
```

Agent může na začátku konverzace zkontrolovat paměť a nenačítat data znovu.

### 4.3 Dlouhodobá paměť (cross-session)

Pro personalizaci: co uživatel řešil v minulých konverzacích, jaké má preference:

```sql
CREATE TABLE ai_user_memory (
  user_id       uuid REFERENCES auth.users(id),
  key           text NOT NULL,  -- 'preferred_language_style', 'known_conditions', ...
  value         jsonb NOT NULL,
  confidence    float DEFAULT 1.0,  -- jak jistí jsme si hodnotou
  source        text,               -- 'user_explicit' | 'inferred' | 'admin_set'
  last_updated  timestamptz DEFAULT now(),
  PRIMARY KEY(user_id, key)
);
```

**Kritické:** Data v `ai_user_memory` jsou citlivá — RLS, `_audited` RPC pattern, zápis pouze přes agent (ne přímý INSERT).

### 4.4 Checkpointing pro long-running tasky

Některé agentní úkoly trvají déle než HTTP timeout (30s). Řešení:

```
Client → POST /ai-task/start → { task_id }
         ← 202 Accepted

[background] edge funkce zpracuje task asynchronně
             → ukládá progress do ai_task_checkpoints

Client → GET /ai-task/{task_id}/status → { progress, partial_result, status }
```

DB:
```sql
CREATE TABLE ai_tasks (
  id          uuid PRIMARY KEY,
  user_id     uuid,
  task_type   text,  -- 'health_analysis', 'study_summary', ...
  status      text,  -- 'queued', 'running', 'done', 'failed'
  input       jsonb,
  result      jsonb,
  progress    int DEFAULT 0,  -- 0–100
  started_at  timestamptz,
  completed_at timestamptz
);
```

**Odhad Fáze 4:** 2–3 týdny.

---

## Fáze 5 — Dynamická kompozice (měsíce 4–8)

> **Cíl:** Pipeline sestava není hardcoded, ale generována dynamicky podle záměru a kontextu.

### 5.1 Graph-based workflow engine

Místo fixní sekvence `classify → specialist → orchestrator` zavést **execution graph**:

```json
// agent_workflow definition v DB
{
  "entry": "intent_router",
  "nodes": {
    "intent_router": {
      "type": "classifier",
      "agent": "classify",
      "transitions": {
        "health_query":      "health_specialist",
        "study_question":    "study_specialist",
        "distribution_info": "distribution_specialist",
        "general":           "main_agent"
      }
    },
    "health_specialist": {
      "type": "agent",
      "agent": "specialist:health",
      "next": "aggregator"
    },
    "study_specialist": {
      "type": "agent",
      "agent": "specialist:studies",
      "next": "aggregator"
    },
    "aggregator": {
      "type": "agent",
      "agent": "main_agent",
      "next": "output_filter"
    },
    "output_filter": {
      "type": "guardrails",
      "config": "from_access_tier",
      "next": null
    }
  }
}
```

**Výhody:**
- Admin může workflow editovat v UI (vizualizace přes `@xyflow/react` — už je v appce!)
- Podmíněné větve a paralelní větve jsou deklarativní
- Lze verzovat (stejný pattern jako `agent_configuration_history`)
- Snadno testovatelné — unit test grafu vs. end-to-end

### 5.2 Paralelní fan-out pro multi-specialist dotazy

Pokud klasifikátor identifikuje více relevantních kategorií:

```
classify → [RTN studium, RTN produkce]  ← obě kategorie
              ↓               ↓
         specialist_A   specialist_B     ← paralelně (Promise.all)
              ↓               ↓
              └────── merge ──┘
                        ↓
                  main_agent (agreguje oba kontexty)
```

### 5.3 Reflexe a self-correction

Po vygenerování odpovědi volitelný "critic" krok:

```
main_agent odpověď → critic_agent (kontroluje guardrails, fakta, relevanci)
                   → IF score < threshold: přegenerovat s feedback
                   → ELSE: odeslat uživateli
```

Critic je levný agent (gpt-5-mini) s strukturovaným výstupem. Max 2 iterace (bezpečnostní pojistka).

**Odhad Fáze 5:** 3–4 týdny.

---

## Fáze 6 — Proaktivní agenti a triggery (měsíce 6–12)

> **Cíl:** Agenti nečekají na uživatelský vstup — sami monitorují, analyzují a iniciují.

### 6.1 Event-driven triggers

Databázové triggery → pg_notify → edge funkce → AI analýza:

| Trigger | AI akce |
|---------|---------|
| Nový lab výsledek uložen | `analyze-lab-result` → osobní komentář do Story |
| Check-in s pain_level > 7 (3 dny po sobě) | Alert Dirigentovi + navrhni eskalaci |
| Longevity skóre kleslo o 5+ bodů | Proaktivní zpráva uživateli s doporučeními |
| Missed dosage (3 dny) | Reminder + analýza příčin |
| Studie approaching deadline | Upomínka + summary pro konzultanta |

**Implementace:** 
- `pg_notify` → Supabase Realtime → edge function subscription
- nebo pg_cron job každých N minut (jednodušší, dostatečné)

### 6.2 Scheduled AI jobs

```sql
-- pg_cron (Supabase má pg_cron dostupný)
SELECT cron.schedule(
  'daily-health-insights',
  '0 8 * * *',  -- každý den v 8:00
  $$SELECT net.http_post(
      url := 'https://[project].functions.supabase.co/ai-daily-insights',
      headers := '{"Authorization": "Bearer ' || current_setting('app.service_key') || '"}'
  )$$
);
```

Výstupy: personalizované insights, týdenní souhrny, proaktivní doporučení.

### 6.3 Study monitoring agent

Periodicky prochází aktivní studie:
- Kohortové statistiky jsou mimo očekávaný rozsah?
- Nízká compliance u konkrétního segmentu účastníků?
- Blíží se enrollment deadline s nedostatečným počtem?

Výstup: alerting pro Dirigenty v admin panelu + notifikace.

**Odhad Fáze 6:** 4–6 týdnů.

---

## Fáze 7 — Škálování a produkční hardening (průběžně)

> **Cíl:** Systém funguje spolehlivě při 100× větší zátěži bez lineárního růstu nákladů.

### 7.1 Multi-provider LLM routing

Abstrakce nad LLM poskytovateli:

### 7.1 Multi-provider LLM routing ✅ IMPLEMENTED

Abstrakce nad LLM poskytovateli — implementováno jako dva moduly:

**LLM Router** (`_shared/llmRouter.ts`):
- `resolveProvider()` — gemini-* → Google, claude-* → Anthropic, else → OpenAI
- `unifiedChat()` — jednotné API pro všechny providery (OpenAI, Gemini, Anthropic)
- `isReasoningModel()` — detekce reasoning modelů (o1/o3/o4/gpt-5)

**Adaptive Model Selection** (`_shared/orchestrationBridge.ts`):
- `classifyMessageComplexity()` — heuristická klasifikace zpráv (greeting → deep_analysis)
- `selectOptimalModel()` — adaptivní výběr z `ai_model_registry` (RPC `get_adaptive_model_tiers`)
- `discover-models` Edge Function — denní multi-provider scan (OpenAI, Anthropic, Google, xAI)
- `ai_model_benchmarks` — evaluační pipeline → automatická adaptace tier mapování

```
Discovery (daily) → ai_model_registry → Eval → Benchmarks
                                                    │
selectOptimalModel() ← get_adaptive_model_tiers() ←─┘
  ├── greeting/simple  → cheapest model (nano/flash)
  ├── moderate        → mid-tier (mini)
  ├── complex         → best non-reasoning
  └── deep_analysis   → best reasoning model
```

**Výhody realizované:**
- Cost optimization: levný model pro jednoduché dotazy, silný pro analýzu
- Auto-discovery: nové modely se automaticky objeví a navrhnou k testování
- Self-improving: po evaluaci se benchmark data automaticky promítnou do výběru
- Multi-provider: funguje pro OpenAI, Anthropic, Google, xAI bez hardcoded logiky

### 7.2 Caching na úrovni klasifikace

Frequently asked questions mají deterministické odpovědi. Cache vrstva:

```sql
CREATE TABLE ai_response_cache (
  cache_key    text PRIMARY KEY,  -- hash(message + access_tier + language)
  response     jsonb NOT NULL,
  hit_count    int DEFAULT 1,
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz
);
```

Cache jen pro nízké access tiery (informační dotazy, ne personalizované odpovědi).

### 7.3 Rate limiting a cost guardrails

Rozšíření existujícího `api_rate_limits` systému o:
- Denní/měsíční token limit per user (podle subscription tier)
- Automatické degradování k levnějšímu modelu při přiblížení limitu
- Admin alerting při překročení celkového denního budgetu

### 7.4 Async queue pro non-real-time tasky

Analýza dokumentů, wearable dat, generování souhrnů — není potřeba real-time:

```
Client → POST /ai-tasks → { task_id: uuid, status: 'queued' }

[Queue worker — edge function na cron]
  → vyzvedne tasky ze stavu 'queued'
  → zpracuje (3–5 paralelně)
  → uloží výsledek, pošle push notifikaci

Client → WS subscription nebo polling → { status: 'done', result: ... }
```

**Supabase Realtime** je ideální pro notifikaci klienta o dokončení.

---

## Závislosti a rizika

### Závislosti (pořadí fází)

```
Fáze 1 (observabilita) → Fáze 3 (evaluace)   [data pro evalutaci]
Fáze 2 (tools)         → Fáze 4 (ReAct loop) [tools jsou prerequisita]
Fáze 4 (paměť)         → Fáze 5 (kompozice)  [state je prerequisita]
Fáze 5 (workflows)     → Fáze 6 (proaktivní) [scheduler potřebuje workflow engine]
```

Fáze 7 (škálování) je průběžná a paralelní ke všem ostatním.

### Hlavní rizika

| Riziko | Dopad | Mitigace |
|--------|-------|----------|
| OpenAI API výpadek/zdražení | Vysoký | Multi-provider routing (Fáze 7.1) |
| Únik citlivých dat přes AI | Kritický | PII masking + audit log + guardrails vždy ON |
| Runaway ReAct loop (nekonečná iterace) | Vysoký | `max_iterations` hard cap (5), timeout per step |
| LLM hallucinations v lékařském kontextu | Kritický | Critic agent + disclaimer povinný pro health kategorie |
| Vysoké náklady na tokeny | Střední | Caching + model routing + usage limity |
| Guardrails obcházení (prompt injection) | Kritický | Jailbreak detection + server-side restriction prompt vždy |

### Invarianty — nikdy nepřekročit

1. **Žádná AI odpověď se neukáže bez prošlých guardrails** — restriction prompt a access tier check jsou vždy server-side, ne frontend
2. **Žádná tool call neprovede write operaci bez explicitní user intent** — tools pro čtení vs. tools pro zápis jsou oddělené kategorie s různou autorizací
3. **Žádné PHI data nevstupují do LLM promtu bez aktivního konsentu** — `has_data_sharing_consent()` check před každým health kontextovým voláním
4. **Každý AI step je tracován** — žádný "slepý" krok bez záznamu

---

## Orientační timeline

| Fáze | Hlavní výstup | Odhad doby |
|------|---------------|------------|
| **0** | Stávající stav (done) | — |
| **0.5** | **MCP Knowledge Server + pgvector** (done) | 1 týden |
| **1** | Trace log, metriky dashboard | 1–2 týdny |
| **2** | Tool registry + executor + 6 toolů | 2–3 týdny |
| **3** | Evaluation pipeline + LLM-as-judge | 1–2 týdny |
| **4** | ReAct loop, session paměť, checkpointing | 3–4 týdny |
| **5** | Graph workflow engine, paralelní fan-out | 4–5 týdnů |
| **6** | Proaktivní triggery, scheduled agents | 3–4 týdny |
| **7** | Multi-provider, cache, async queue | průběžně |

**Celkem na autonomní systém (Fáze 0.5–6):** ~4–5 měsíců při 1 FTE.

---

## Fáze 0.5 — MCP Knowledge Server (IMPLEMENTOVÁNO)

> **Cíl:** Zpřístupnit Guild of Experts znalostní bázi přes MCP protokol jakémukoliv AI konzumentovi.

### Co bylo vytvořeno

**1. pgvector migrace** (`supabase/migrations/20260228000000_mcp_knowledge_vector_search.sql`):
- Aktivace `pgvector` extension
- `content_embedding vector(1536)` sloupec na `expert_rules` s HNSW indexem
- `search_expert_rules_semantic()` — vektorové hledání přes kosínovou podobnost
- `mcp_search_knowledge()` — kombinované text + tag hledání s relevance scoring
- `mcp_get_expertise_areas()` — přehled expertních oblastí s počty
- `mcp_get_rule_detail()` — kompletní obsah pravidla včetně dokumentů
- `mcp_match_experts()` — matching expertů podle oblasti a kontextových tagů
- `mcp_get_agent_knowledge()` — pravidla navázaná na konkrétního agenta

**2. MCP Server Edge Function** (`supabase/functions/mcp-knowledge-server/index.ts`):
- JSON-RPC 2.0 over Streamable HTTP transport
- 35 MCP tools (Phase 0–4): `search_knowledge`, `get_expert_rule`, `get_expertise_areas`, `match_experts`, `get_agent_knowledge`, `get_project_context`, dirigent_*, delivery_*, admin_*
- 1 MCP resource: `evymo://knowledge/overview`
- 1 MCP prompt: `project_knowledge_brief`
- CORS-aware, service role DB access pro čtení published pravidel

**3. Shared MCP Protocol Library** (`supabase/functions/_shared/mcp-protocol.ts`):
- `McpServer` class s registrací tools, resources, prompts
- JSON-RPC 2.0 dispatcher s proper error handling
- Batch request support
- Type-safe content helpers (`textContent`, `jsonContent`, `markdownContent`)

**4. Knowledge Import Script** (`scripts/import-knowledge-to-expert-rules.ts`):
- Import `knowledge-extraction/` dokumentů jako expert_rules
- 10 dokumentů s metadata (category, expertise area, AI context tags)
- Idempotentní (ON CONFLICT DO UPDATE)
- Režimy: `--sql-only` nebo přímý DB import přes pg

### Připojení MCP serveru

```json
// VS Code / Cursor / Claude Desktop — MCP config
{
  "mcpServers": {
    "aisha-knowledge": {
      "transport": {
        "type": "http",
        "url": "https://<project-ref>.supabase.co/functions/v1/mcp-knowledge-server"
      }
    }
  }
}
```

### Architekturní diagram

```
┌─────────────────────────────────────────────────────────┐
│  MCP CONSUMERS                                          │
│  VS Code │ Cursor │ Claude │ CI/CD │ External Teams     │
└────────────────────────┬────────────────────────────────┘
                         │ JSON-RPC 2.0 (MCP)
┌────────────────────────▼────────────────────────────────┐
│  MCP Knowledge Server (Edge Function)                   │
│  tools: search | get_rule | match_experts | context     │
└────────────────────────┬────────────────────────────────┘
                         │ supabase.rpc()
┌────────────────────────▼────────────────────────────────┐
│  PostgreSQL                                              │
│  expert_rules │ guild_expertise_areas │ partner_profiles │
│  pgvector embeddings │ agent_rule_bindings               │
└─────────────────────────────────────────────────────────┘
```

---

## Co se NESMÍ změnit (architektonické invarianty AISHA)

Navzdory rozšiřování AI vrstvy zůstávají v platnosti všechna pravidla z [AGENTS.md](../AGENTS.md):

- **RPC-only pattern** — AI agenti přistupují k datům výhradně přes RPC funkce, nikdy přímý SQL nebo `.from()` dotaz
- **Audit journal** — každé čtení citlivých dat přes `_audited` RPC zapisuje záznam
- **SECURITY DEFINER** — všechny nové RPC potřebné pro tools musí mít správný search_path
- **Žádné sensitive data v logu** — trace events v `ai_trace_events` ukládají pouze `metadata`, nikdy obsah zpráv ani zdravotní data
- **Guardrails jsou server-side** — nikdy se nespolehuj na frontend pro bezpečnostní kontroly

---

*Pro otázky, doplnění priorit nebo zahájení konkrétní fáze — otevři diskusi v Issues nebo na Dirigent review session.*
