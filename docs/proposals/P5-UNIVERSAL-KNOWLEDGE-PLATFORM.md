# P5: Univerzální Knowledge & RAG Platform — AISHA Knowledge Engine

**Status:** Draft  
**Priority:** P0 (strategický)  
**Datum:** 2026-06  
**Autor:** AISHA Ecosystem Audit  

---

## 1. Executive Summary

Abstrakce stávajících RAG/chatbot/knowledge komponent do **univerzálního, konfigurovatelného platformního nástroje**, který:

- Funguje napříč projekty (AISHA + libovolné tenant projekty, ...)
- Podporuje **lokální** i **cloudový** backend
- Spojuje upload dat → indexaci → vektorové úložiště → kontextově-vědomý retrieval → LLM routing
- Poskytuje **per-story/domain izolaci kontextu** jako klíčový diferenciátor
- Napojuje se na existující AISHA chat interface včetně debuggingu a historie

---

## 2. Audit stávajícího stavu

### 2.1 Co už existuje (a funguje)

| Komponenta | Stav | Kde | Popis |
|------------|------|-----|-------|
| **Ragnarok RAG Engine** | ✅ Produkce | `packages/insight/ragnarok/` | Python, Elasticsearch hybrid BM25+KNN, query rewrite, reranking |
| **Edge Function: ragnarok-search** | ✅ Produkce | `supabase/functions/ragnarok-search/` | Proxy do Ragnarok API s auth |
| **Edge Function: ragnarok-upload** | ✅ Produkce | `supabase/functions/ragnarok-upload/` | Upload/list/delete KB dokumentů, admin-only |
| **Edge Function: generate-knowledge-embeddings** | ✅ Produkce | `supabase/functions/generate-knowledge-embeddings/` | OpenAI text-embedding-3-small → knowledge_chunks → knowledge_embeddings |
| **MCP Knowledge Server** | ✅ Produkce | `supabase/functions/mcp-knowledge-server/` | 30+ MCP tools: search_knowledge_v2, compose_context, search_ragnarok, ... |
| **compose_context() RPC** | ✅ Produkce | `supabase/sql/functions/compose_context.sql` | 4-layer context assembly s token budgeting a project scoping |
| **mcp_search_knowledge_v2() RPC** | ✅ Produkce | Migrace `20260321140000` | Hybrid vektorový + textový search se scoring (vector 40 + tags 10 + text 15 + verified 5) |
| **AI Chat Edge Function** | ✅ Produkce | `supabase/functions/ai-chat/` | Kompletní chat pipeline: auth → access → guardrails → compose_context → workflow engine → LLM → response |
| **Orchestration Bridge** | ✅ Produkce | `supabase/functions/_shared/orchestrationBridge.ts` | routeViaAisha, enrichWithAishaContext, selectOptimalModel, detectEscalationSignals |
| **AISHA Chat UI** | ✅ Produkce | `src/components/chat/AiChatWidget.tsx` | Sheet chat, conversation history, debug mode, AISHA Dirigent badge |
| **useAiChat hook** | ✅ Produkce | `src/hooks/useAiChat.ts` | Full chat lifecycle: access, conversations, messages, send via Edge Function |
| **n8n Agent Workflows** | ✅ Produkce | `n8n/workflows/WF_*.json` | 7 agentů: Dirigent, Knowledge, Compliance, Delivery, Ragnarok, Model Router, Self-Deploy |
| **AishaLlmRouter** | ✅ Produkce | `packages/n8n-nodes-aisha/` | Multi-provider LLM routing (OpenAI, Gemini, Anthropic) |
| **Admin Ragnarok KB UI** | ✅ Produkce | `src/pages/admin/AdminRagnarokKB.tsx` | Upload/list/delete KB v admin panelu |
| **Project Presets** | ✅ Nové | `supabase/sql/tables/project_presets.sql` | Šablony pro bootstrapování stories s předkonfigurovanými pravidly |
| **create_story_from_preset()** | ✅ Nové | `supabase/sql/functions/create_story_from_preset.sql` | Automatické provisioning story z presetu |
| **KB Sync Workflow** | ✅ Produkce | `n8n/workflows/WF_KB_RAGNAROK_SYNC.json` | Synchronizace knowledge_items → Ragnarok Elasticsearch |

### 2.2 Co chybí / je rozbitné

| Problém | Dopad | Priorita |
|---------|-------|----------|
| **knowledge_chunks = 0 řádků lokálně** | Vektorový search v compose_context vrací prázdné výsledky | CRITICAL |
| **knowledge_embeddings = 0 řádků lokálně** | Žádné embeddings pro semantic search | CRITICAL |
| **Ragnarok API 429/500** | Externí API kvóta → RAG search degraduje | HIGH |
| **Žádná UI pro spuštění embedding pipeline** | Manuální curl na generate-knowledge-embeddings | MEDIUM |
| **Tvrdě kódovaný project_id = "evymo"** | Ragnarok nemá per-story izolaci | HIGH |
| **Žádný unified knowledge dashboard** | Admin spravuje KB, chat a stories odděleně | MEDIUM |
| **Chybí webhook pro auto-indexaci** | Po uploadu dokumentu se neindexuje automaticky | MEDIUM |
| **Maestro (Python orchestrator) je legacy** | Duplicitní orchestrace s TypeScript/n8n stack | LOW |

### 2.3 Dva paralelní knowledge pipelines

Aktuálně existují **dva nezávislé** pipelines, které se překrývají:

```
Pipeline A: PostgreSQL Knowledge (Supabase-native)
─────────────────────────────────────────────────
knowledge_items (body_markdown + ai_instructions)
    │
    ├─→ generate-knowledge-embeddings (Edge Function)
    │       │
    │       ├─→ knowledge_chunks (chunked text, ~500 tokens)
    │       └─→ knowledge_embeddings (OpenAI text-embedding-3-small, 1536 dims)
    │
    └─→ mcp_search_knowledge_v2 (hybrid vector + text + tag scoring)
            │
            └─→ compose_context (project-scoped KB retrieval layer)

Pipeline B: Ragnarok (Elasticsearch-native)
─────────────────────────────────────────────────
Dokumenty (PDF, DOCX, TXT, MD, CSV)
    │
    ├─→ ragnarok-upload (Edge Function → Ragnarok API)
    │       │
    │       └─→ Elasticsearch (chunking + embeddings + BM25 index)
    │
    └─→ ragnarok-search (Edge Function → Ragnarok RAG pipeline)
            │
            ├─→ KNN cosine search + BM25 search
            ├─→ Reciprocal Rank Fusion
            ├─→ Optional reranking
            └─→ Optional LLM generation
```

**Klíčový insight:** Oba pipelines dělají v podstatě totéž (chunk→embed→search→retrieve), ale:
- Pipeline A je integrovaná přímo v PostgreSQL (pgvector) — **vhodná pro strukturovaná knowledge items s metadaty a tagy**
- Pipeline B je Elasticsearch-native — **vhodná pro velké dokumenty (PDF, Word) s highlight a reranking**

---

## 3. Cílová architektura: AISHA Knowledge Engine (AKE)

### 3.1 Princip

**Jeden unified knowledge pipeline** s konfigurovatelným backendem, per-story izolací, a třemi režimy operace:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AISHA Knowledge Engine (AKE)                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. INGEST LAYER                                                │   │
│  │     Data Sources → Chunking → Embedding → Storage              │   │
│  │                                                                 │   │
│  │  Sources:                     Processing:                       │   │
│  │  ├── knowledge_items (PG)     ├── Semantic chunking (~500 tok) │   │
│  │  ├── Documents (PDF/DOCX/..)  ├── OpenAI embeddings (1536d)    │   │
│  │  ├── URLs / scraping          ├── Metadata extraction          │   │
│  │  ├── API imports (webhook)    └── Tag inference                │   │
│  │  └── Manual entry (UI)                                         │   │
│  └─────────────────────────────┬───────────────────────────────────┘   │
│                                │                                        │
│  ┌─────────────────────────────▼───────────────────────────────────┐   │
│  │  2. STORAGE LAYER (switchable backends)                         │   │
│  │                                                                 │   │
│  │  Backend A: pgvector (Supabase-native)                         │   │
│  │  └── knowledge_chunks + knowledge_embeddings + tags + scores   │   │
│  │                                                                 │   │
│  │  Backend B: Elasticsearch (Ragnarok)                           │   │
│  │  └── Dense vectors + BM25 text index + highlights + reranking  │   │
│  │                                                                 │   │
│  │  Backend C: Qdrant / Pinecone / Weaviate (future)              │   │
│  │  └── Pluggable via adapter interface                           │   │
│  │                                                                 │   │
│  │  👆 Konfigurace per-story v partner_stories.build_config       │   │
│  └─────────────────────────────┬───────────────────────────────────┘   │
│                                │                                        │
│  ┌─────────────────────────────▼───────────────────────────────────┐   │
│  │  3. RETRIEVAL LAYER (unified search API)                        │   │
│  │                                                                 │   │
│  │  search_knowledge_unified({                                     │   │
│  │    story_id,                   -- context isolation             │   │
│  │    query,                       -- user query                   │   │
│  │    query_embedding?,            -- pre-computed embedding       │   │
│  │    context_tags[],              -- project/domain tags          │   │
│  │    backends[],                  -- ['pgvector','ragnarok']      │   │
│  │    fusion_strategy,             -- 'rrf' | 'weighted' | 'best' │   │
│  │    limit, threshold             -- result tuning               │   │
│  │  }) → scored, ranked results                                    │   │
│  │                                                                 │   │
│  │  Scoring: vector_sim*40 + tag_overlap*10 + text_match*15       │   │
│  │           + verified*5 + freshness*5 + backend_boost            │   │
│  └─────────────────────────────┬───────────────────────────────────┘   │
│                                │                                        │
│  ┌─────────────────────────────▼───────────────────────────────────┐   │
│  │  4. CONTEXT LAYER (compose_context v2)                          │   │
│  │                                                                 │   │
│  │  compose_context_v2({                                           │   │
│  │    story_id,                                                    │   │
│  │    context_profile,                                             │   │
│  │    query,                                                       │   │
│  │    agent_slug,                                                  │   │
│  │  }) → { layers, tokens_used, token_budget }                    │   │
│  │                                                                 │   │
│  │  Layers:                                                        │   │
│  │  ├── project_context (story metadata + build_config)           │   │
│  │  ├── ruleset (expert_rules per story)                          │   │
│  │  ├── kb_retrieval (unified search across all backends)         │   │
│  │  ├── agent_memory (per-agent persistent memory)                │   │
│  │  └── memory (ai_trace_events from current run)                 │   │
│  └─────────────────────────────┬───────────────────────────────────┘   │
│                                │                                        │
│  ┌─────────────────────────────▼───────────────────────────────────┐   │
│  │  5. AGENT LAYER (LLM routing + chat)                            │   │
│  │                                                                 │   │
│  │  ┌──────────────────────┐  ┌──────────────────────┐            │   │
│  │  │   AI Chat (EF)       │  │  n8n Agents          │            │   │
│  │  │   ├── guardrails     │  │  ├── Dirigent         │            │   │
│  │  │   ├── compose_ctx    │  │  ├── Knowledge        │            │   │
│  │  │   ├── workflow engine │  │  ├── Compliance       │            │   │
│  │  │   └── LLM call       │  │  ├── Ragnarok         │            │   │
│  │  └──────────┬───────────┘  │  └── Delivery         │            │   │
│  │             │              └──────────┬─────────────┘            │   │
│  │             └───────┬────────────────┘                          │   │
│  │                     ▼                                            │   │
│  │            selectOptimalModel()                                  │   │
│  │            ├── OpenAI (GPT-4o, GPT-4o-mini)                     │   │
│  │            ├── Anthropic (Claude Sonnet/Opus)                   │   │
│  │            ├── Google (Gemini 2.x)                              │   │
│  │            └── Local (Ollama, via Ragnarok)                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  6. UI LAYER (unified knowledge dashboard)                      │   │
│  │                                                                 │   │
│  │  /admin/knowledge-engine                                        │   │
│  │  ├── Story selector (context isolation)                        │   │
│  │  ├── Knowledge sources (upload, import, manage)                │   │
│  │  ├── Embedding status (pipeline health, counts, gaps)          │   │
│  │  ├── Search playground (test queries, see scores)              │   │
│  │  ├── Chat tester (test context composition in chat)            │   │
│  │  └── Configuration (backends, models, thresholds per story)    │   │
│  │                                                                 │   │
│  │  /chat (existing AISHA chat)                                    │   │
│  │  └── Enhanced with per-story context from AKE                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Per-story izolace kontextu (klíčový diferenciátor)

```
partner_stories.build_config (JSONB) — rozšíření:
{
  "knowledge_engine": {
    "backends": ["pgvector", "ragnarok"],      // Aktivní backendy
    "ragnarok_project_id": "example-tenant",   // Izolace v Elasticsearch
    "embedding_model": "text-embedding-3-small", // Konfigurovatelný model
    "embedding_dimensions": 1536,
    "retrieval": {
      "fusion_strategy": "rrf",                // Reciprocal Rank Fusion
      "k_vector": 10,
      "k_bm25": 10,
      "similarity_threshold": 0.3,
      "max_chunks": 15
    },
    "generation": {
      "model": "auto",                         // selectOptimalModel()
      "temperature": 0.4,
      "max_tokens": 4096
    },
    "auto_index": true,                        // Automatická indexace po uploadu
    "auto_embed": true                         // Trigger generate-knowledge-embeddings
  }
}
```

Každý projekt (AISHA + libovolný tenant projekt...) tak může mít:
- **Vlastní knowledge sources** (izolované přes project tags + ragnarok_project_id)
- **Vlastní retrieval nastavení** (jiné thresholdy, jiné backendy)
- **Vlastní LLM model** (tenant projekt → Gemini, AISHA → GPT-4o, ...)
- **Sdílená infrastruktura** (stejný Elasticsearch, stejný pgvector, stejné Edge Functions)

### 3.3 Switchable backends — adapter interface

```typescript
// Navržené rozhraní pro backend adapter (Edge Function / RPC)

interface KnowledgeBackendAdapter {
  /** Backend identifier */
  readonly id: string;
  
  /** Ingest a document → chunks + embeddings */
  ingest(params: {
    story_id: string;
    content: string;
    metadata: Record<string, unknown>;
    source_type: 'markdown' | 'pdf' | 'docx' | 'url';
  }): Promise<{ chunks_created: number; embeddings_created: number }>;
  
  /** Search for relevant chunks */
  search(params: {
    query: string;
    query_embedding?: number[];
    context_tags: string[];
    limit: number;
    threshold: number;
  }): Promise<ScoredChunk[]>;
  
  /** Delete chunks for a source */
  delete(params: {
    source_id: string;
  }): Promise<void>;
  
  /** Health check */
  health(): Promise<{ status: 'ok' | 'degraded' | 'down'; latency_ms: number }>;
}

// Implementace:
// - PgVectorAdapter: uses knowledge_chunks + knowledge_embeddings tables
// - RagnarokAdapter: uses Elasticsearch via ragnarok-search proxy
// - (future) QdrantAdapter, PineconeAdapter, etc.
```

---

## 4. Implementační plán — 5 epoch

### Epocha 1: Oprava základů (CRITICAL — prerequisite)

**Cíl:** Obě knowledge pipelines funkční s daty.

| # | Úkol | Typ | Odhad |
|---|------|-----|-------|
| 1.1 | Spustit `generate-knowledge-embeddings` pro všechny aktivní knowledge_items | Ops | S |
| 1.2 | Ověřit knowledge_chunks + knowledge_embeddings mají data | Ops | XS |
| 1.3 | Otestovat compose_context s reálnými daty (ne prázdný kb_retrieval) | Test | S |
| 1.4 | Ověřit Ragnarok connectivity + vyřešit 429 kvótu | Ops | S |
| 1.5 | Sync knowledge_items → Ragnarok (n8n WF_KB_RAGNAROK_SYNC) | Ops | S |

**Výstup:** Oba pipelines vrací reálné výsledky pro testovací queries.

### Epocha 2: Unified Search API

**Cíl:** Jeden search endpoint, který prohledává oba backendy a fúzuje výsledky.

| # | Úkol | Typ | Odhad |
|---|------|-----|-------|
| 2.1 | Vytvořit RPC `search_knowledge_unified()` | SQL | M |
| 2.2 | Implementovat Reciprocal Rank Fusion pro merge výsledků | SQL | M |
| 2.3 | Přidat per-story konfigurace backendu do `build_config` | SQL migrace | S |
| 2.4 | Upravit `compose_context` na použití `search_knowledge_unified` | SQL | M |
| 2.5 | Přidat MCP tool `search_knowledge_unified` do mcp-knowledge-server | TypeScript | S |
| 2.6 | Testy pro unified search | Test | M |

**Výstup:** `compose_context` používá unified search, výsledky jsou relevantní z obou backendů.

### Epocha 3: Auto-indexace pipeline

**Cíl:** Upload KB → automatická indexace do obou backendů.

| # | Úkol | Typ | Odhad |
|---|------|-----|-------|
| 3.1 | DB trigger/webhok na knowledge_items INSERT → generate-knowledge-embeddings | SQL + EF | M |
| 3.2 | Po embed v pgvector → sync do Ragnarok (pokud backend aktivní) | n8n WF | S |
| 3.3 | Admin UI: zobrazit embedding status per knowledge_item | React | M |
| 3.4 | Admin UI: "Re-index" button pro manuální re-embed | React | S |
| 3.5 | Healthcheck endpoint pro embedding pipeline stav | EF | S |

**Výstup:** Nový knowledge_item → automaticky chunked, embedded, indexed ve všech aktivních backendech.

### Epocha 4: Knowledge Dashboard UI

**Cíl:** Unified admin UI pro správu knowledge engine per story.

| # | Úkol | Typ | Odhad |
|---|------|-----|-------|
| 4.1 | Admin stránka `/admin/knowledge-engine` | React | L |
| 4.2 | Story selector s přehledem knowledge sources | React | M |
| 4.3 | Upload panel (documents, URLs, manual entry) | React | M |
| 4.4 | Embedding pipeline status (health, counts, gaps) | React | M |
| 4.5 | Search playground (query → scored results z obou backendů) | React | M |
| 4.6 | Konfigurace per-story (backends, modely, thresholdy) | React | M |
| 4.7 | Integrace s existujícím AISHA chat (test composed context) | React | S |

**Výstup:** Admin/staff může spravovat knowledge pro jakýkoli projekt v jednom dashboard.

### Epocha 5: Multi-tenant + local backend support

**Cíl:** Platforma funguje v self-hosted i cloud režimu.

| # | Úkol | Typ | Odhad |
|---|------|-----|-------|
| 5.1 | Backend adapter interface (TypeScript + SQL) | Arch | L |
| 5.2 | PgVectorAdapter (refactor existujícího) | TypeScript | M |
| 5.3 | RagnarokAdapter (refactor existujícího) | TypeScript | M |
| 5.4 | Docker compose profily: `local` (pgvector only) vs `full` (+ Elasticsearch) | DevOps | M |
| 5.5 | Konfigurace via environment variables (ne hardcoded URLs) | DevOps | S |
| 5.6 | Dokumentace: jak přidat nový projekt s vlastním knowledge | Docs | M |
| 5.7 | (Optional) Ollama / local LLM support v selectOptimalModel | TypeScript | L |

**Výstup:** Platforma nasaditelná na libovolném prostředí s konfigurovatelným backend.

---

## 5. Mapování na existující kód

### Co se refaktoruje:

| Existující | Cílový stav | Poznámka |
|------------|-------------|----------|
| `ragnarok-search` EF | Zůstane, ale volaná přes adapter | Bez breaking changes |
| `ragnarok-upload` EF | Zůstane, rozšíření o auto-embed trigger | |
| `generate-knowledge-embeddings` EF | Zůstane, přidání webhook triggeru | |
| `mcp_search_knowledge_v2` RPC | Zůstane jako pgvector backend | |
| `compose_context` RPC | Upgrade na unified search | Hlavní změna |
| `AdminRagnarokKB.tsx` | Integrace do Knowledge Dashboard | |
| `useRagnarokKB.ts` | Rozšíření o unified hooks | |

### Co se přidá nového:

| Nové | Vrstva | Popis |
|------|--------|-------|
| `search_knowledge_unified` RPC | SQL | Fúzní search přes backendy |
| `knowledge_engine_config` sloupec | SQL | Per-story konfigurace v build_config |
| `/admin/knowledge-engine` | React | Unified dashboard |
| `useKnowledgeEngine` hook | React | CRUD + search + status |
| Backend adapter interface | TypeScript | Pluggable backendy |
| Auto-index webhook | n8n / EF | Trigger po insertu |

### Co se nezmění:

- `ai-chat` Edge Function (konzumuje compose_context, ten se zlepší transparentně)
- `orchestrationBridge.ts` (volá compose_context, výsledek bude bohatší)
- `AiChatWidget.tsx` (UI zůstane, lepší kontext bude neviditelný pro uživatele)
- n8n workflows (MCP tools se rozšíří, agenti budou mít lepší knowledge)

---

## 6. Rozhodovací matice: Lokální vs Cloud

| Aspekt | Lokální (pgvector only) | Cloud (pgvector + Ragnarok) | Full (+ Qdrant/Pinecone) |
|--------|------------------------|----------------------------|--------------------------|
| Závislosti | PostgreSQL only | + Elasticsearch + Ragnarok API | + další služby |
| Kvalita hledání | Dobrá (vector + text) | Výborná (hybrid + reranking + highlights) | Nejlepší |
| Škálovatelnost | ~100K chunks | ~10M chunks | Neomezená |
| Latence | <100ms | <500ms | Variabilní |
| Náklady | Minimální | Střední (ES cluster) | Variabilní |
| Setup | `docker compose up` | + Elasticsearch container | + SaaS credentials |

**Doporučení:** Default = pgvector (vždy dostupný). Ragnarok = opt-in per story. External = future.

---

## 7. Rizika a mitigace

| Riziko | Pravděpodobnost | Dopad | Mitigace |
|--------|----------------|-------|----------|
| Ragnarok API nestabilní | Vysoká | Vysoký | Backend fallback do pgvector-only |
| OpenAI embedding API ratelimit | Střední | Střední | Batch processing, retry s backoff |
| Složitost unified search | Střední | Střední | Iterativní přístup, epoch 1 musí fungovat |
| Per-story config complexity | Nízká | Nízký | Sensible defaults, override only when needed |
| Breaking changes v compose_context | Nízká | Vysoký | Backward-compatible API, nový endpoint p_version |

---

## 8. Inspirace z referenčního zákaznického chatbotu

Referenční zákaznický public chatbot ukazuje klíčové principy, které chceme generalizovat:

1. **Decision-making**: Chatbot rozhoduje kam routovat query (general info, specialist search, appointment booking) → **route_task pattern existuje**
2. **Agent routing s know-how**: Specializovaní agenti s doménovou znalostí → **n8n workflows + MCP tools existují**
3. **Kontextové odpovědi**: Odpovědi zahrnují relevantní KB obsah → **compose_context existuje**
4. **Multi-jazyčnost**: CZ/EN s auto-detekcí → **i18n + language detection existuje**

**Co chybí pro tenant nasazení:**
- Per-story izolace (tenant knowledge nesmí leakovat do AISHA chatu)
- Tenant-specifický guardrails profil (např. doménová citlivost)
- Tenant-specifické LLM nastavení (konzervativnější temperature pro citlivé domény)
- Auto-onboarding: create story from preset → instant knowledge

→ Všechno řeší **per-story konfigurace v build_config** z sekce 3.2.

---

## 9. Metriky úspěchu

| Metrika | Cíl | Jak měřit |
|---------|-----|-----------|
| Knowledge coverage | >90% queries vrací relevantní chunk | Search playground + manuální audit |
| Retrieval latency | p95 < 500ms | ai_trace_events timing |
| Context relevance | >80% compose_context obsahuje useful info | User feedback (rate_chat_message) |
| Zero-config onboarding | Nový projekt spuštěn za <5 min | create_story_from_preset + auto-index |
| Backend flexibility | Funguje s pgvector only, i s Ragnarok | E2E testy obou konfigurací |

---

## 10. Závěr

**Většina infrastruktury už existuje.** Klíčové práce jsou:

1. **Opravit základy** — embeddings pipeline musí mít data (epoch 1)
2. **Sjednotit search** — jeden API endpoint pro oba backendy (epoch 2)
3. **Automatizovat** — upload → index → embed pipeline (epoch 3)
4. **Dashboard** — unified UI pro story-based knowledge management (epoch 4)
5. **Abstrahovat** — backend adapter pro local/cloud flexibility (epoch 5)

Odhadovaný scope: **~40 story points** (epochy 1-3 pro MVP, 4-5 pro full platform).
