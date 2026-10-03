# Spec 01 — Dynamický top-K výběr toolů (RAG nad tool katalogem)

> **Priorita:** Vysoká · **Effort:** M (≈ 1–2 sprinty) · **Riziko:** Střední
> **Odysseus zdroj:** `src/tool_index.py`, `src/tool_policy.py` (clean-room, jen jako návrhový vzor)

---

## 1. Problém

AISHA dnes do LLM/agenta posílá **celý statický katalog ~42 MCP toolů každý turn**.

Evidence (current state):
- `services/svc-mcp-knowledge/src/routes/mcp.ts` — `TOOL_DEFINITIONS: ToolDefinition[]` je hardcoded pole; servíruje se verbatim v `/mcp` odpovědi. Žádné filtrování, žádný top-K.
- `services/svc-ai-chat/src/lib/toolBuilder.ts` — schéma má `shouldDefer` flag, ale MCP server na něj nereaguje (deferred loading není implementovaný).
- `capability-resolver.ts` existuje, ale jen pro **RAG LLM purposes** (`rag.embedding`, `rag.rerank`, …), ne pro výběr toolů.

**Důsledky:**
- Context bloat — schémata + access rules sní context dřív, než začne user request. Bolí hlavně malé/lokální modely (Qwen3-30B self-hosted, 4k–16k okna). Tohle je i Odysseus ROADMAP priorita („Agent prompt/context bloat").
- Horší tool-selection accuracy — víc nerelevantních toolů = víc špatných volání.
- Vyšší náklady a latence na každý turn.

---

## 2. Jak to řeší Odysseus (návrhový vzor)

`tool_index.py` — třída `ToolIndex`:
- Při startu embedne popisy toolů do ChromaDB kolekce (lane: fastembed / custom).
- `retrieve(query, k=8)` vrátí top-K relevantních tool names per user message.
- **Tři vrstvy, ne jen embeddings:**
  1. `ALWAYS_AVAILABLE` (frozenset) — pár ambientních toolů vždy (memory „remember this", `ask_user`). Záměrně malá množina.
  2. **Embedding retrieval** top-K nad popisy.
  3. **Keyword/intent fallback** (`_KEYWORD_HINTS`, regex i fuzzy „every <word>" pro překlepy) — když retrieval mine doménu (e.g. „serve model", „contacts"), tool se přesto přidá.
- Důvod kombinace: čisté embeddingy občas minou trivální ale kritické tooly; keyword seedy to dorovnají bez nafouknutí promptu.

Doplňkově `tool_policy.py` (per-turn `ToolPolicy` dataclass): `disabled_tools` / `hidden_tools` / `block_all_tool_calls` — výběr se skládá *po* retrieveru (viz spec 05).

---

## 3. Best-practice cílový design pro AISHA (dynamický)

**Princip:** nezavádět paralelní systém — využít, co už existuje (embed dispatcher, model registry, capability-resolver, consent/audit gates).

### 3.1 Index toolů
- Nová tabulka / kolekce `agent_tool_embeddings` (pgvector — AISHA už pgvector má) s `tool_name`, `description`, `embedding`, `embedding_model_id`, `tier`, `family`.
- Embedovat přes existující `embed-dispatcher.ts` (stejný invariant: model se nikdy nedefaultuje, query model == corpus model — viz `embed-query-in-space.ts`).
- Rebuild indexu při změně tool katalogu (hook na deploy / migraci), ne za běhu.

### 3.2 Selection resolver
- Funkce `resolveToolSet(query, context)` ve `svc-mcp-knowledge` nebo `svc-ai-chat`:
  1. `ALWAYS` množina (memory, ask_user, a co je pro AISHA ambientní).
  2. Top-K embedding retrieval (K dynamicky dle context window modelu — viz spec 03, ne fixní 8).
  3. Keyword/intent fallback nad doménami AISHA (compliance, flowboard, knowledge, …).
  4. **Po výběru** aplikovat existující gates: `accessTierMin`, `requiresConsent`, role families (`AUTHENTICATED_TOOLS` / `AITG_TOOLS` / `ADMIN_TOOLS`). Bezpečnost se nesmí obejít retrieverem.
- Sjednotit s `aisha_resolve_clow_backend` filozofií — ideálně jako další „purpose" resolveru, ať je jeden konzistentní mechanismus (health-aware, TTL cache).

### 3.3 Dynamičnost (cíl uživatele)
- **K** = funkce context-window modelu a počtu kandidátů, ne konstanta.
- **Práh relevance** konfigurovatelný per context profile.
- **Cold-start / nízký signál** (prompt „test") → jen `ALWAYS`, žádné doménové schémata.
- **Telemetrie** (Langfuse): logovat zvolené tooly vs. skutečně volané → měřit precision/recall výběru a ladit práh.

---

## 4. Scope

**In-scope:**
- Embedding index tool katalogu (pgvector) + rebuild flow.
- `resolveToolSet()` se třemi vrstvami + napojení na consent/audit/tier gates.
- Integrace do MCP listing endpointu (`mcp.ts`) a/nebo chat orchestrace (`chat.ts`) — feature-flag `dynamic_tool_selection`.
- Telemetrie výběru.

**Out-of-scope:**
- Sjednocený embedding prostor „tooly + knowledge chunky" (zajímavé, ale samostatný research; viz overview gap table).
- Změny v exekuci toolů (`toolExecutor.ts`) — výběr je čistě pre-flight.
- Deferred *loading* schémat po síti (MCP protocol-level) — zde řešíme jen *selection*.

---

## 5. Integrační body
- `services/svc-mcp-knowledge/src/lib/embed-dispatcher.ts` (embedding)
- `services/svc-mcp-knowledge/src/routes/mcp.ts` (tool listing)
- `services/svc-ai-chat/src/lib/toolBuilder.ts` (`shouldDefer`, tier metadata)
- `services/svc-ai-chat/src/lib/toolExecutor.ts` (consent/audit gates — beze změn, jen respektovat)
- `aisha_resolve_clow_backend` RPC (sjednocení resolver filozofie)
- `ai_model_registry` (context window pro dynamické K — sdílí se spec 03)

## 6. Rizika
- **Bezpečnost:** retriever NESMÍ obejít tier/consent gates. Mitigace: gates aplikované *po* výběru, fail-closed default z `toolBuilder.ts`.
- **Recall miss:** kritický tool vypadne z výběru. Mitigace: keyword fallback + `ALWAYS` množina + telemetrie + feature flag s rychlým rollbackem na „all tools".
- **Index drift:** embeddingy zastarají po změně katalogu. Mitigace: rebuild jako součást deploy/migrace, verzování `embedding_model_id`.
- **Multilingual:** dotazy CZ/EN — embedding model musí zvládat oba (AISHA má Brick3 multilinguality, využít stejný princip).

## 7. Akceptační kritéria
- Pro trivální prompt („test", „ahoj") se do promptu dostane jen `ALWAYS` množina (měřitelné v Langfuse).
- Pro doménový prompt se zvolí relevantní tool(y) s recall ≥ baseline (statický katalog = 100 % recall, ale 100 % bloat) na eval setu.
- Žádný non-admin/low-tier tool se nedostane k uživateli bez práva (regression test nad gates).
- Feature flag off → identické chování jako dnes.
