# AISHA Self-Managing Organism — Vize & Epoch Roadmap

> **Role tohoto dokumentu:** dlouhodobá *vize* a 5-epochová evoluce AISHA k autonomii.
> **Živý stav** (co je hotové / rozpracované) a detailní task tracking drží
> [MASTER_PLAN.md](MASTER_PLAN.md) — unified view, který tento dokument nahrazuje pro
> sledování postupu. Zde zůstává směr a koncept, ne stavové značky.

AISHA je organismus složený z:

- **Dirigenta** — mozek, n8n orchestrace
- **MCP Knowledge Serveru, knowledge grafu, vector RAG a cross-session paměti** —
  paměť (viz sekce *Knowledge & Memory layer* níže)
- **vývojářského rozhraní** — VS Code / Claude Code extension
- **Edge Functions a `svc-*` microservices** — reflexy
- **zpětnovazebních smyček** — učení

Masterplan má 5 epoch; každá posouvá AISHA k vyšší úrovni autonomie. Iterativně, bez
deadline — každá session řeší jeden logický celek.

---

## Platform substrate (aktuální)

n8n orchestrační vrstva běží jako produkční stack v Coolify
(`docker-compose.coolify-n8n.yml`):

- **n8n v queue režimu** (`EXECUTIONS_MODE=queue`) — dedikovaný **worker** + **Redis 7**
  (Bull queue); image pinováno přes `IMAGE_N8N` (Coolify auto-deploy)
- **PostgreSQL 17** backend (schema `n8n`), oddělené od AISHA aplikační DB
- **`n8n-nodes-aisha` v0.5.8** — 9 custom nodes (`AishaRpc`, `AishaAudit`,
  `AishaStoryManager`, `AishaModelRouter`, `AishaLlmRouter`, `AishaTrigger`,
  `AishaNodeFactory`, `AishaAdminBridge`, `AishaGitHubApp`) + 6 credential typů
  (`AishaPostgrestApi`, `AishaMcpApi`, `AishaNocoDbApi`, `AishaLangfuseApi`,
  `AishaGitHubApi`, `AishaAppsmithApi`); nody se loadují přes `N8N_CUSTOM_EXTENSIONS`,
  ne přes community-packages API
- **~87 workflows** (`n8n/workflows/WF_*.json`) pokrývajících orchestraci, compliance,
  delivery, observability a self-* smyčky; provisioning + credential remap řeší
  `bootstrap/` self-setup (activation retry s backoff)
- Publikováno na privátní **Verdaccio** (`npm.id3a.cz`); balíček je non-scoped
  (`n8n-nodes-aisha`, Caddy %2f workaround), `@evymo/*` scope hostuje legacy balíčky
- URL: `https://n8n.aisha.guru`

> Kanonický zdroj počtů a verzí je `packages/n8n-nodes-aisha/package.json` (`n8n` blok)
> a adresář `n8n/workflows/` — čísla výše se mění, nepřepisuj je ručně jako stav.

---

## Knowledge & Memory layer (aktuální)

„Paměť" organismu není jen MCP Knowledge Server — je to vícevrstvý retrieval + memory
stack. Kanonický kontext-assembler je `aisha/db/sql/functions/compose_context.sql`;
retrieval backend řeší `orchestrationBridge` (`pgvector | ragnarok | hybrid`):

- **Vector RAG (pgvector)** — `knowledge_items` → `knowledge_chunks` (s contextual-prefix)
  → `knowledge_embeddings` (HNSW/cosine; `vector(1536)`, paralelní migrace na `vector(2560)`
  Qwen). Hybrid retrieval `mcp_search_knowledge_v2` (vektor + text + tag overlap + verified
  bonus + `quarantine_status` filtr); embedding pipeline = auto-trigger + `WF_EMBEDDING_REFRESH`
- **Ragnarok** — externí hybrid RAG engine (Alquist Insight: BM25 + KNN + rerank,
  Elasticsearch). Per-projekt/story KB scoping; sync z `knowledge_items`/`expert_rules` přes
  `WF_KB_RAGNAROK_SYNC` + `fn_build_ragnarok_document`. Proxied přes `svc-aisha-kronos-shim`
  (Kronos vědomě vynechán — AISHA má vlastní RPC vrstvu místo Mongo/MinIO)
- **Knowledge graph** — `graph_nodes` (typed entity store + pgvector) + `graph_edges`
  (13 typů vztahů, confidence). LLM extrakce: `WF_GRAPH_EXTRACT_NIGHTLY` →
  `svc-mcp-knowledge /graph/extract/run` → `fn_apply_graph_extraction_audited`; traversal
  `fn_graph_multihop`, run-context `fn_get_run_graph_context` (+ UI ExplainabilityPanel);
  a nově **retrieval vrstva `graph_context` v `compose_context`** (seed z `kb_retrieval`
  chunků → `fn_graph_multihop`, enabled na RAG profilech) — graf je teď vstup do uvažování,
  ne jen post-hoc explainability
- **Maestro** — dialog-management provider (multi-turn koherence, Alquist Insight); volaný
  výhradně přes `svc-ai-chat /story-consult` (brain wiring se skládá předtím — vynucuje gate
  `insight-usp-integrity`)
- **Cross-session paměť** — `ai_session_memory` (TTL), `ai_user_memory` (long-term +
  confidence), `agent_memories` (embedded, importance/TTL); načítá `memoryManager`
- **Brain layers** — Tao (governance), Psyché (personality DNA), Hippocampus
  (`hippocampus.ts`: traits + signal capture → `fn_maybe_evolve_personality`), Occipitum
  (trace/observability) — skládané v `compose_context` + `createHippocampus`
- **Kvalita & bezpečnost** — `WF_RAG_EVAL_NIGHTLY` (golden set + judge scoring + baseline
  regression), prompt-injection scan + `quarantine_status` filtr v retrievalu

**Aktuální zralost / known gaps** (stav vs. vize — ověřit živě, detail v `MASTER_PLAN.md`
a `docs/reports/`):

- ✅ **Graf je nově retrieval vrstvou** (tato story). `compose_context` má vrstvu
  `graph_context` hned po `kb_retrieval` (seed z retrieved items → `fn_graph_multihop`),
  zapnutou na rich-context RAG profilech — `chat_lightweight` záměrně zůstává lean. Migrace
  `20260603002713_compose_context_graph_layer.sql`, gate `compose-context-graph-layer`.
  Graf je teď vstup do uvažování, ne jen explainability UI. „Kolik/jestli použít" řeší
  self-guard (no-op bez dat) + výběr profilu per-task; přínos měří `WF_RAG_EVAL_NIGHTLY`.
- **Vektorové embeddingy** — pipeline je wired, ale backfill nutno ověřit živě (per audit
  lokálně 0 řádků kvůli rate-limitu); bez nich `mcp_search_knowledge_v2` degraduje na text/BM25.
- **Runtime self-control (`WF_DIRIGENT_*`)** — workflows existují, aktivaci v n8n ověřit.

---

## Epocha 0 — Propojení (Bridge)
*„AISHA vidí sama sebe"*

Kritický prerekvizit — bez propojení produkční ai-chat pipeline s
Router/Composer/MCP infrastrukturou funguje vše izolovaně.

- **Context Composer do ai-chat** — napojit produkční chat na `compose_context()` RPC;
  4-layer kontext (project, ruleset, kb_retrieval, memory) místo hardcoded system promptu
- **Router do ai-chat** — `route_task()` RPC rozhoduje agenta, model, kontext a gates;
  nahrazuje fixní classify → specialist → main pipeline dynamickým routingem přes
  `agent_catalog`
- **Sjednocení `agent_configurations` vs `agent_catalog`** — migrace nebo bridge vrstva
- **`ai_runs` ↔ n8n trace logging** — trace events z n8n se zapisují do `ai_trace_events`

*Cíl:* AISHA odpovídá s reálným 4-layer kontextem z Composeru; produkční ai-chat
routuje přes `route_task()`.

## Epocha 1 — Sebeuvědomění
*„AISHA monitoruje a opravuje sebe"*

- **Community node dependency** — `n8n-nodes-aisha` se instaluje z Verdaccio při startu
  kontejneru (entrypoint); nody přes `N8N_CUSTOM_EXTENSIONS`
- **Watchdog workflows** — `WF_ADMIN_HEALTH_MONITOR`, `WF_NIGHTLY_STORY_AUDIT`,
  `WF_LANGFUSE_PERFORMANCE_REVIEW`
- **Self-deploy pipeline** — `WF_SELF_DEPLOY`: git push → git server webhook → n8n sync
  workflow JSONů
- **Observability** — Langfuse (traces/costs) napojený na `ai_agent_metrics_hourly`;
  denní report, anomálie → `WF_EXPERT_NOTIFICATION`
- **Health → Self-Healing smyčka** — health monitor detekuje degradaci → circuit breaker
  (max pokusy/h) → eskalace lidské obsluze

*Cíl:* AISHA detekuje výpadek služby, pokusí se o recovery a při neúspěchu notifikuje
experta; denní performance report přichází automaticky.

## Epocha 2 — Sebezdokonalování
*„AISHA se učí z vlastních chyb"*

- Automatizovaná knowledge ingestion (event-driven re-import při změně KB zdrojů)
- Evaluace kvality AI odpovědí (LLM-as-judge: relevance/accuracy/helpfulness, golden
  dataset jako baseline, regression testing)
- Feedback → Knowledge loop (nízké skóre → identifikace knowledge gapu → návrh rozšíření)
- Cross-session paměť (`ai_session_memory`, `ai_user_memory`)
- Auto-generace copilot/agent instrukcí z aktuálního rulesetu
- AI Model Registry & auto-discovery (denní scan providerů → benchmark → adaptive tiers →
  `selectOptimalModel()`)

*Cíl:* AISHA po špatné odpovědi sama identifikuje, co jí chybělo, a navrhne rozšíření KB;
model selection se adaptuje na dostupné a evaluované modely.

## Epocha 3 — Řízení projektů
*„AISHA řídí delivery lifecycle"*

- Story Delivery Engine — state machine (draft → specifying → ready → in_progress →
  review → testing → done) s gates (compliance, quality, approval)
- PR Compliance Gate end-to-end (PR → webhook → `WF_PR_COMPLIANCE_GATE` → diff analýza →
  verdikt → Check Run; při failu → `WF_COMPLIANCE_REROUTE` → auto-fix → re-check)
- Human-in-the-loop governance (`WF_APPROVAL_GATE` pro HIGH/CRITICAL; timeout → eskalace)
- Negotiator mode — dělba práce mezi AISHA (delivery/compliance/knowledge/orchestrace) a
  vývojářským agentem (implementace/testy/migrace/build)
- Entitlements — AI budget, token limity a cost tracking per uživatel/partner

*Cíl:* AISHA řídí story od návrhu po release; compliance gate automaticky blokuje
nekvalitní kód; expert schvaluje kritická rozhodnutí přes approval gate.

## Epocha 4 — Multi-Projekt
*„AISHA slouží celé platformě"*

- Project context isolation — per-projekt `story_rulesets`, `expert_rules`,
  `context_profiles`; AISHA přepíná kontext podle projektu
- Guild formalizace — role, skill matching, expert availability
- Knowledge transfer mezi projekty (lessons learned → doporučení v podobném projektu)
- Release management — changelog, version bumpy, staging → production promotion
- Backlog management — AISHA generuje a prioritizuje úkoly z health/compliance/knowledge
  signálů

*Cíl:* AISHA řídí 2+ projekty současně, každý s vlastním kontextem; nový projekt se
onboarduje přes guided flow s automatickým nastavením rulesetu.

---

## Principy

- **Iterativní přístup** — každá session = 1–2 kroky, ne celá epocha najednou
- **Epocha 0 (Bridge) je blokátor** — bez propojení nelze efektivně pokračovat dál
- **`agent_configurations` vs `agent_catalog`** — architektonické rozhodnutí, které
  ovlivňuje vše; nutno sjednotit
- **Stav a tracking** drží [MASTER_PLAN.md](MASTER_PLAN.md); tento dokument je *vize a směr*
