# Epocha 2 — Sebezdokonalování: Knowledge, Evaluation, Memory

> **Status:** ✅ COMPLETED  
> **Cíl:** Aisha má naplněnou znalostní bázi, umí se sebe-evaluovat a zlepšovat kvalitu odpovědí  
> **Předpoklady:** Epocha 0 ✅ (Bridge), Epocha 1 ✅ (Sebeuvědomění)

---

## Stav infrastruktury (červenec 2025)

### ✅ Existuje (ale prázdné)

| Komponenta | Stav | Detaily |
|------------|------|---------|
| `knowledge_items` | Schema ✅, Data ✅ (22) | 15 domain_doc + 7 engineering_doc, seeded z guild_expertise_areas + agent_catalog |
| `knowledge_chunks` | Schema ✅, Data ❌ (0) | Chunking s section tracking, source_field |
| `knowledge_embeddings` | Schema ✅, Data ❌ (0) | vector(1536), pgvector 0.8.0 |
| `knowledge_moderation_queue` | Schema ✅, Data ❌ (0) | Review pipeline |
| `agent_knowledge_sources` | Schema ✅, Data ❌ (0) | Agent-to-knowledge binding |
| `ai_eval_runs` | Schema ✅, Data ❌ (0) | Eval run metadata, 4-dim scoring |
| `ai_eval_results` | Schema ✅, Data ❌ (0) | Per-message scores |
| `mcp_search_knowledge_v2()` | RPC ✅ | Hybrid vector + text + tag search |
| `mcp_get_knowledge_item()` | RPC ✅ | Single item fetch |
| `mcp_get_agent_knowledge()` | RPC ✅ | Agent-specific knowledge |
| `generate-knowledge-embeddings/` | Edge fn ✅ | Chunking + OpenAI embedding pipeline |
| Admin stránky | 5 AI pages ✅ | AdminAiEvaluation, AdminKnowledge, AdminAiObservability, ... |
| Hooks | 16+ hooks ✅ | useEvalRuns, useGoldenExamples, useAiAgentMetrics, ... |
| Agent catalog | 7 agentů ✅ | dirigent, librarian, compliance_gate, dev_patch, verifier, aisha_planner, debug_agent |
| Agent configurations | 12 konfigurací ✅ | Routing, models, instructions |

### ❌ Chybí

| Komponenta | Co je třeba |
|------------|------------|
| ~~`ai_golden_examples` tabulka~~ | ✅ Vytvořena migrací 20260308222720 |
| ~~`agent_decision_trees` tabulka~~ | ✅ Vytvořena + 2 seed stromy (dirigent/task_routing, compliance_gate/risk_assessment) |
| Agent memory/session persistence | Žádný mechanismus pro long-term memory |
| ~~Znalostní data~~ | ✅ 22 knowledge_items seeded (migration) |
| Vektorové embeddingy | 0 — edge function nebyla spuštěna |
| Eval execution backend | LLM-as-Judge pipeline neimplementován |

---

## Úkoly

### 2.1 — Knowledge Foundation Seed ⭐ PRIORITA

**Cíl:** Naplnit knowledge_items základními znalostmi platformy tak, aby `mcp_search_knowledge_v2` vrátil relevantní výsledky.

#### 2.1.1 — Seed z guild_expertise_areas (15 oblastí) ✅
- [x] SQL migrace `20260308222720`: 15 knowledge_items z guild_expertise_areas (typ `domain_doc`)
- [x] Každá oblast = title + description + ai_context_tags

#### 2.1.2 — Seed z agent_catalog (7 agentů) ✅
- [x] SQL migrace `20260308222720`: 7 knowledge_items z agent_catalog (typ `engineering_doc`)
- [x] Každý agent = slug, purpose, default_model, safety_level, allowed_tools

#### 2.1.3 — Platform Documentation Knowledge Items ✅
- [x] SQL migrace `20260308235500`: 10 knowledge_topics seedovaných z AGENTS.md (portálový přístup)
- [x] Sync trigger `trg_sync_topic_version_to_ki` → knowledge_items (automatic sync při INSERT/UPDATE)
- [x] 10 knowledge_topic_versions (v1) s body_markdown — pravidla: RPC-only, testing, migration, security, i18n, code-hygiene, DB patterns, audit journal, error handling, agent architecture
- [x] `knowledge_topic_translations` tabulka — LLM translation cache (provider, model, token_count, latency_ms, quality_score)
- [x] Typ: `engineering_doc`, source_type: `knowledge_topic`, visibility: `guild`, verified: true

#### 2.1.4 — LLM Translation Pipeline ✅
- [x] Rewrite `translate-content` edge function — `llmRouter.unifiedChat()`, model routing (gpt-5-mini <2000 chars / gpt-5 ≥2000 chars nebo code/tables)
- [x] Cache-first pattern se `source_hash` (SHA-256 truncated) pro invalidaci
- [x] Dual content type: `post` → `knowledge_post_translations`, `topic` → `knowledge_topic_translations`
- [x] Metrics recording (token_count, latency_ms, provider, model)
- [x] SQL migrace `20260309000100`: 3 RPCs + RLS policy
  - `get_topic_translation(slug, locale)` — cache-first read, vrací originál pokud locale=source
  - `get_translation_metrics_admin(days)` — UNION ALL přes topic + post translations
  - `rate_topic_translation(version_id, locale, score)` — feedback loop + audit journal
- [x] `useKnowledgeTranslation.ts` hook — 3 hooks: `useTopicTranslation`, `useTranslationMetrics`, `useRateTranslation`

#### 2.1.5 — Spustit Embedding Pipeline ✅
- [x] Ověřit `generate-knowledge-embeddings` edge function lokálně (supabase functions serve)
- [x] Fix source_field bug: `"body_markdown"` → `"body"` (constraint check violation)
- [x] Spustit pro všechny seeded items → 32/32 items, 62 chunks, 62 embeddings vygenerováno
- [x] Fix `mcp_search_knowledge_v2` visibility filter: přidán `'guild'` do WHERE clause (migrace `20260309080300`)
- [x] Ověřit `mcp_search_knowledge_v2` vrací výsledky — "RPC-Only Pattern" score=20, "Bezpečnostní vzory" score=20

### 2.2 — Golden Examples & Eval Execution

**Cíl:** Eval pipeline funguje end-to-end — admin může spustit eval run a vidí skóre.

#### 2.2.1 — Golden Examples Table ✅
- [x] Migrace `20260308222720`: `ai_golden_examples` tabulka (user_message, assistant_message, routing_category, model_used, 4-dim expected_scores, admin_notes)
- [x] RLS: admin_or_staff read/write
- [x] RPC: `get_golden_examples_admin` — vytvořen v migraci
- [x] Hook: `useGoldenExamples` — EXISTUJE, kompatibilní

#### 2.2.2 — Eval Execution Edge Function ✅
- [x] Edge function `evaluate-ai-response/index.ts` — EXISTOVALA, opravena a rozšířena
- [x] Pipeline: načti golden examples z `ai_golden_examples` → LLM-as-Judge scoring (relevance, groundedness, safety, coherence)
- [x] Zapisuje do `ai_eval_results` (s golden_example_id, nullable message_id)
- [x] Aktualizuje `ai_eval_runs` s průměrnými skóry (avg_overall=0.996 v testu)
- [x] Podporuje trigger_type: manual, scheduled
- [x] Migrace `20260309082922`: fix eval schema (nullable message_id, golden_example_id FK, 8 golden examples seed)
- [x] Migrace `20260309084500`: fix missing updated_at column on ai_eval_runs (trigger fix)
- [x] Service_role auth pro batch eval (edge function accepts service_role tokens)

#### 2.2.3 — Propojení s Admin UI
- [x] `useStartEvalRun` hook volá edge function přes `supabase.functions.invoke`
- [x] `useCreateEvalRun` → `create_eval_run_admin` RPC (opraveno: počítá z ai_golden_examples)
- [ ] Ověřit end-to-end flow z Admin UI (vyžaduje admin uživatele)

### 2.3 — Agent Decision Trees

**Cíl:** Agenti mají formalizované rozhodovací stromy pro routing a eskalaci.

#### 2.3.1 — Decision Tree Schema ✅
- [x] Migrace `20260308222720`: `agent_decision_trees` tabulka (JSONB tree_definition, trigger_context enum)
- [x] Migrace: `ALTER TABLE agent_catalog ADD COLUMN autonomy_level` (manual/semi/full)
- [x] RLS: admin_or_staff, RPC: `get_agent_decision_trees_admin`, `consult_decision_tree`

#### 2.3.2 — Seed Decision Trees ✅
- [x] Dirigent: task_routing strom (7 kategorií + risk assessment fallback)
- [x] Compliance Gate: risk_assessment strom (sensitivity → scope → decision)

#### 2.3.3 — Route Task Integration ✅
- [x] Migrace `20260309090000`: route_task konzultuje dirigent's task_routing decision tree
- [x] Fallback na stávající CASE logiku pokud strom neexistuje/neresolve
- [x] Compliance tree konzultace pro risk assessment (compliance_gate's risk_assessment)
- [x] Dirigent tree rozšířen (v2): podpora task_kind hodnot (project_delivery, pr_gate, chat, incident, doc_update)
- [x] `routing_method` field v route_plan a response (decision_tree/hardcoded)
- [x] Source of truth `supabase/sql/functions/route_task.sql` aktualizován
- [x] Types regenerovány, TypeScript 0 errors

### 2.4 — Agent Memory

**Cíl:** Agenti si pamatují kontext z předchozích interakcí.

#### 2.4.1 — Agent Memory Table
- [x] Migrace: `agent_memories` tabulka (agent_slug, user_id, memory_type, content, importance, expires_at)
- [x] memory_type: `fact`, `preference`, `context`, `instruction`
- [x] TTL: expires_at pro automatický cleanup
- [x] Migrace `20260309091500_agent_memory_system.sql` (#101) — tabulka + RLS + indexy + trigger

#### 2.4.2 — Memory MCP Tools
- [x] `mcp_store_agent_memory` — uložit memory (testováno: fact, preference, instruction)
- [x] `mcp_get_agent_memories` — načíst relevant memories pro kontext (řazení dle importance)
- [x] `mcp_summarize_agent_memories` — kompaktní shrnutí (by_type, top_memories)

#### 2.4.3 — Integrace do compose_context
- [x] `compose_context.sql` — přidán `agent_memory` layer + `p_agent_slug` parametr (5. param)
- [x] Token budget: ~50 tokenů/memory, max_memories konfigurováno v context_profiles
- [x] Source of Truth aktualizován, typy regenerovány (26998 řádků), tsc 0 errors

### 2.5 — Self-Improvement Loop ✅

**Cíl:** Aisha analyzuje svou výkonnost a navrhuje zlepšení.

#### 2.5.1 — Performance Analysis RPC ✅
- [x] `analyze_agent_performance(p_hours_back, p_agent_slug)` — 5 sekcí: runs stats (by_kind, error_rate), trace stats (per-agent P95), eval stats (weak_areas), top errors, slow operations
- [x] Metriky: error_rate, avg_duration, P95 latence, eval scores s weak_areas detekcí (relevance<0.8, groundedness<0.8, safety<0.9, coherence<0.8)
- [x] Migrace #102 (`20260309093000_self_improvement_loop.sql`)

#### 2.5.2 — Improvement Proposal Pipeline ✅
- [x] `improvement_proposals` tabulka — proposal_type (prompt_tweak, model_change, temperature_adjustment, guardrail_update, tool_config_change, instruction_rewrite), status workflow (draft→pending_review→approved→applied→rejected), source (manual, eval_analysis, performance_alert, user_feedback), priority 1-10
- [x] `create_improvement_proposal_admin` RPC — admin/staff vytváří návrhy s current_value/proposed_value jsonb
- [x] `list_improvement_proposals_admin` RPC — filtrování dle status/agent, řazení dle priority

#### 2.5.3 — Admin Approval & Application ✅
- [x] `approve_improvement_proposal_admin(p_proposal_id, p_review_note, p_auto_apply)` — auto-apply snapshotuje config do agent_configuration_history, pak CASE na proposal_type aplikuje změnu (model→model+model_settings, temperature→temperature, prompt→instructions+version++, guardrail→guardrails_config, tool→tools_config)
- [x] `reject_improvement_proposal_admin(p_proposal_id, p_review_note)` — zamítnutí s poznámkou
- [x] Otestováno: approve s auto_apply=true změnil temperature 0.70→0.50, history záznam vytvořen; reject funguje
- [x] Types regenerovány (27118 řádků), tsc 0 chyb

### 2.6 — AI Model Registry & Auto-Discovery ✅

**Cíl:** Aisha si sama zjišťuje dostupné modely od všech providerů, testuje je, vyhodnocuje a adaptivně vybírá nejlepší model pro každou úroveň složitosti konverzace.

#### 2.6.1 — Multi-Provider Model Discovery ✅
- [x] `discover-models` Edge Function — skenuje OpenAI (`/v1/models`), Anthropic (ping known models), Google (`/v1beta/models`), xAI (`/v1/models`)
- [x] `upsert_discovered_model()` RPC — upsert do `ai_model_registry` (26 sloupců: provider, model_id, capabilities, pricing, eval status)
- [x] `mark_models_unavailable()` RPC — flaguje modely co zmizely z API
- [x] Filtruje chat-capable modely, extrahuje model family, detekuje reasoning capability
- [x] Auto-creates `improvement_proposals` s `proposal_type: "model_change"` pro nové modely
- [x] Auto-triggers eval runs via `create_eval_run_admin()` RPC
- [x] n8n workflow: denní spuštění 03:00 UTC

#### 2.6.2 — Complexity Classification ✅
- [x] `classifyMessageComplexity()` — score-based heuristika (word count, patterns, escalation signals)
- [x] 5 úrovní: `greeting` → `simple` → `moderate` → `complex` → `deep_analysis`
- [x] ANALYTICAL_PATTERNS (28 regex CS+EN), TECHNICAL_PATTERNS (18 regex), GREETING_PATTERNS (3 regex)
- [x] Bez LLM volání — rychlé pattern matching + word counting

#### 2.6.3 — Adaptive Model Selection ✅
- [x] `selectOptimalModel()` — async, přijímá SupabaseClient, čte z `ai_model_registry`
- [x] `get_adaptive_model_tiers()` RPC — dvou-fázová strategie:
  - Phase A: benchmark-based (post-evaluace) — `overall_score`, `avg_cost_per_call`
  - Phase B: heuristic-based (pre-evaluace) — pricing + model name patterns
- [x] Fallback na hardcoded `FALLBACK_MODEL_TIERS` když je registr prázdný
- [x] `ModelSelectionResult.source` pole — `"registry"` vs `"fallback"` pro auditovatelnost
- [x] Risk escalation: compliance/approval → minimum tier `complex`
- [x] Migrace `20260313080000_adaptive_model_tiers.sql`

#### Self-Improving Cycle
```
discover-models (daily 03:00 UTC)
  │
  ├── Scan: OpenAI, Anthropic, Google, xAI APIs
  ├── Upsert: ai_model_registry (capabilities, pricing)
  ├── Propose: improvement_proposals (model_change)
  └── Eval: create_eval_run_admin → ai_model_benchmarks
       │
       └── get_adaptive_model_tiers() → selectOptimalModel()
            └── ai-chat uses best model per complexity tier
```

---

## Blocker Dependencies

| Blocker | Blokuje | Řešení |
|---------|---------|--------|
| OpenAI API key v lokální Supabase | 2.1.4 (embedding) | `.env` nebo `vault.secrets` |
| n8n restart (stále z Epochy 0) | Monitoring workflows | Restart kontejneru na Coolify |
| Langfuse external routing | 2.5 telemetrie | Traefik fix (priorita nízká) |

---

## Pořadí implementace

```
2.1 Knowledge Seed ──┐
                     ├→ 2.1.4 Embeddings → mcp_search funguje
2.2 Golden + Eval ───┤
                     ├→ Eval pipeline end-to-end
2.3 Decision Trees ──┤
                     ├→ Routing improvement  
2.4 Agent Memory ────┘
                     
2.5 Self-Improvement Loop ← závisí na 2.1-2.4
```

**Quick wins first:** 2.1.1 + 2.1.2 (SQL seed) → 2.2.1 (golden table) → 2.3.1 (decision trees)

---

## Navigace Masterplanu

| Epocha | Název | Status |
|--------|-------|--------|
| 0 | Bridge | ✅ DONE (n8n restart pending) |
| 1 | Sebeuvědomění (monitoring, self-healing) | ✅ DONE |
| **2** | **Sebezdokonalování (knowledge, evaluation, memory)** | **✅ DONE** |
| 3 | Řízení projektů (delivery engine, PR gates, negotiator) | Not started |
| 4 | Multi-Projekt (project isolation, guild, release) | Not started |
