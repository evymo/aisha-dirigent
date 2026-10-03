# Insight Integration (Alquist Insight: Ragnarok + Maestro)

> **Status:** Integrated as P0 (2026-04). Maestro = LLM provider adapter v `svc-ai-chat`,
> Ragnarok = retrieval engine za AISHA knowledge loop. Brain layer wiring (Tao,
> Psyche, Hippocampus, Occipitum, governance) aplikovaný před každým Maestro
> turn skrz `compose_context` + `orchestrationBridge`.

## Co integrujeme

[Alquist Insight](https://github.com/AlquistAI/insight) je open-source RAG platforma
od **Alquist Research team (FEL ČVUT)**, vítězů **Amazon Alexa Prize Socialbot
Grand Challenge**. Stack má 4 komponenty — Kronos, Maestro, Ragnarok, Clients.
V AISHA využíváme **maximum toho, co dává smysl**:

| Komponenta | Stav | Důvod |
|---|---|---|
| **Ragnarok** | ✅ integrovaný | Retrieval engine (BM25 + KNN hybrid) za AISHA knowledge loop. KB se plní z `knowledge_items` přes `auto_embed_trigger` → `WF_KB_RAGNAROK_SYNC` do Elasticsearch. |
| **Maestro** | ✅ integrovaný | Dialog management vrstva (multi-turn coherence z Alexa Prize). LLM provider adapter v `svc-ai-chat` orchestraci. |
| **Kronos** | ❌ NEintegrujeme | AISHA RPC layer (`partner_stories`, `knowledge_items`, `story_rulesets`) plně nahrazuje Kronosovo Mongo+MinIO project/KB management. |
| **Clients** | ❌ NEintegrujeme | Místo Alquist Admin Console máme NocoDB + Appsmith + AISHA Story KB tab. |

**Žádný Azure** — `azure-identity` / `azure-storage-blob` jsou pouze v Kronos
Pipfile, ten nepoužíváme.

## Klíčový princip orchestrace

**Maestro NIKDY není volán přímo z frontendu** — vždy přes
`services/svc-ai-chat /story-consult` orchestraci, která aplikuje:

1. **Pre-turn**: `enrichWithAishaContext` → `compose_context` RPC vrátí 4 vrstvy:
   - `governance_context` (Tao principy → warmth floor, no-punitivity)
   - `psyche_context` (Psyche traits → babička pattern, empatie-first)
   - `kb_retrieval` (pgvector + Ragnarok hybrid hits)
   - `project_context` (story-specific data)
2. **Pre-turn**: `createHippocampus` → `fn_search_personality_context` (base DNA +
   per-user evolved traits). `buildPersonalityPrompt` injectuje do system promptu.
3. **Pre-turn**: `detectEscalationSignals` → frustration/compliance/incident/highValue.
4. **LLM call**: `unifiedChat` s providerem `maestro` (model `maestro-story-{id}`).
   Maestro dostane assembled prompt — sám už nepostavuje Tao/Psyche/Hippocampus.
5. **Post-turn**: `decisionProvenance` zaznamenává governance metadata, `personality_traits_used`.
6. **Post-turn**: `hippocampus.captureSignal` (frustration/gratitude/curiosity)
   fire-and-forget. Po N signálech `fn_maybe_evolve_personality` triggers evoluci.

Frontend hook **`useStoryConsult`** (alias existujícího `useStoryAiConsult`) volá
`svc-ai-chat /story-consult`. **`useMaestro` hook NEEXISTUJE** — gate test
[insight-usp-integrity.gate.test.ts](../src/tests/gates/insight-usp-integrity.gate.test.ts)
explicitně kontroluje, že soubor `src/hooks/useMaestro.ts` neexistuje.

## Lokální stack

### Spuštění

```bash
# Plný setup (Supabase CLI + Insight)
npm run setup -- --with-insight

# Nebo přímo přes docker compose
npm run insight:up

# Health checks
curl http://localhost:9696/health  # Ragnarok
curl http://localhost:8020/health  # Maestro
curl http://localhost:9200/_cluster/health  # Elasticsearch

# E2E smoke test (USP coherence assert)
npm run smoke:insight
```

### Porty

| Service | Port | Účel |
|---|---|---|
| Elasticsearch | 9200 | Vector backend (BM25 + KNN) |
| Ragnarok | 9696 | RAG engine API (FastAPI) |
| Maestro | 8020 | Dialog management API |
| vLLM Embedding | 8123 | (opt-in, vyžaduje GPU) |
| vLLM Generation | 8100 | (opt-in, vyžaduje GPU) |

## Produkční topologie

Nasazení na **Coolify Backend server** (separate from core AISHA on Frontend) přes
[docker-compose.coolify-integration.yml](../docker-compose.coolify-integration.yml).
Edge functions na Talosu komunikují přes **NetBird mesh DNS**:

- `RAGNAROK_URL=http://backend.mesh.aisha.internal:9696`
- `MAESTRO_URL=http://backend.mesh.aisha.internal:8020`

Žádný public Traefik vstup pro Maestro/Ragnarok — komunikace JEN přes mesh +
service-role proxy přes `svc-mcp-knowledge`.

## LLM backend toggle (`INSIGHT_LLM_BACKEND`)

Ragnarok a Maestro defaultně používají **OpenAI** (lepší produkční model). Pro
on-prem GPU node lze přepnout na **vLLM** (Qwen3-30B-A3B):

```bash
# .env.coolify nebo override v Coolify UI
INSIGHT_LLM_BACKEND=vLLM           # ↔ OpenAI (default)
OPENAI_KEY=EMPTY                    # vLLM nepotřebuje klíč
OPENAI_BASE_URL=${VLLM_GENERATION_URL}
```

Toggle je volitelný **i v produkci** — per-node decision (závisí na hardware).
vLLM kód je v `packages/insight/ragnarok/ragnarok/generation/vllm.py` (NvidiaVLLM).

## Runtime model switching (admin)

Admin/staff může runtime přepnout aktivní AI model přes **dva entry pointy**:

1. **VS Code Dirigent extension** — paleta příkazů: `AISHA: Switch Active AI Model
   (admin)`. Dropdown s `ai_model_registry`, toggle `is_admin_active` flag.
2. **NocoDB / Appsmith admin view** — direct edit `ai_model_registry.is_admin_active`
   (audit-traced přes `AishaAdminBridge` n8n node).

Backend RPCs ([20260428112918_insight_maestro_provider.sql](../aisha/db/migrations/20260428112918_insight_maestro_provider.sql)):

- `list_ai_models_admin(p_provider, p_only_available)` — admin/staff JWT only.
- `set_active_ai_model_admin(p_provider, p_model_id, p_is_active)` — audit_journal entry.
- `get_active_ai_model_for_tier(p_provider)` — read-only lookup.

### **Žádný redeploy potřeba** ⚡

Model switch je čistě **runtime DB read** přes `get_adaptive_model_tiers()` RPC,
volaný **per-request** v `selectOptimalModel`. Po toggle override → další request
už dostane nový model. Žádný edge function restart, žádný container redeploy.

Setup/install backendu (Workbench warmup + Setup panel) řeší **deploy** —
samostatný toolchain, separátní concerns. Runtime override je doplněk, ne paralelní
flow. **Nerozdvojujeme logiku.**

## Story-driven KB upload

KB dokumenty se uploadují **výhradně v rámci Story** (per-story namespace
`kb_id = story-{storyId}`). Žádný separátní KB tab v Workbench, žádný upload v
chat UI — AISHA není klasický chatbot.

UI komponenta: [StoryKnowledgeUpload.tsx](../src/components/storyloop/StoryKnowledgeUpload.tsx)
(integrovaná v `StoryDetail`). Hook: [useStoryKnowledge.ts](../src/hooks/useStoryKnowledge.ts).

Per-story retrieval: `compose_context` automaticky filtruje Ragnarok hits podle
`kb_ids: ["story-${storyId}"]` (přes `orchestrationBridge.enrichWithAishaContext`).

## Brain layer integrita (USP zachování)

Insight integrace **nesmí** obejít AISHA brain vrstvy. Gate test
[insight-usp-integrity.gate.test.ts](../src/tests/gates/insight-usp-integrity.gate.test.ts)
kontroluje:

1. **Deploy**: `ragnarok` + `maestro` services aktivní, žádný `_API_KEY: "disabled"` regression.
2. **Code wiring**: provider adapter, MCP routes, hooky, Story UI komponenta.
3. **Brain layer**: migrace pro Tao/Psyche/Hippocampus/Occipitum existují,
   `compose_context.sql` má 4 vrstvy, `orchestrationBridge` volá Ragnarok merge.
4. **Sandbox**: SSRF protection v Maestro provider, MCP `/maestro/chat` je
   service-role-only.

Pokud kterýkoliv test failne, je to **regrese**, ne feature.

## Reference

- Submodule pin: [repo.id3a.cz/aisha/insight](https://repo.id3a.cz/aisha/insight) — AISHA fork;
  nese generické `czech_folded`/`czech_folded_ascii` BM25 analyzery (`text.cs`/`text.cs_ascii`
  sub-fields). Existující indexy upgradne jednorázové, idempotentní
  `VectorStore().upgrade_czech_subfield()`. QA nástroj: `scripts/rag/czech-doc-analyze.sh`.
- Upstream Alquist Insight repo: [github.com/AlquistAI/insight](https://github.com/AlquistAI/insight)
- Alquist Research team: vítězové [Amazon Alexa Prize Socialbot Grand Challenge](https://www.amazon.science/alexa-prize)
- Brain layer architektura: [N8N_AGENT_ARCHITECTURE.md](N8N_AGENT_ARCHITECTURE.md)
- LLM Router: [LLM_ROUTER.md](LLM_ROUTER.md)
- Self-Managing Organism roadmap: `docs/AISHA-Self-Managing-Organism.md`

## Plán: co NEDĚLÁME (ze záměru)

- ❌ Kronos integrace — AISHA RPC nahrazuje.
- ❌ MongoDB / dedikovaný MinIO — důsledek dropu Kronos.
- ❌ Azure libs — pouze Kronos je vyžadoval.
- ❌ Alquist Admin Console deploy — máme NocoDB + Appsmith.
- ❌ Workbench KB tab / chat upload widget — upload jen ve Story.
- ❌ Paralelní `ai_model_registry` — backend hotový (`agent_catalog` + `ai_model_registry` + `WF_MODEL_ROUTER`).
- ❌ Paralelní KB upload pipeline — single source je `knowledge_items` + `auto_embed_trigger` + `WF_KB_RAGNAROK_SYNC`.
- ❌ `useMaestro` frontend hook — frontend volá Maestra JEN přes `svc-ai-chat /story-consult`.
- ❌ Maestro buildí system prompt sám — dostane assembled prompt z `compose_context`.
- ❌ Paralelní governance gate / personality pipeline — vše přes `governedOrchestration` + `hippocampus`.
