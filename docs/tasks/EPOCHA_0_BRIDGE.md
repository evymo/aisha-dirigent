# Epocha 0 — Bridge: Propojení starého a nového světa AISHY

> **Status:** DONE (0.8 zbývá aktivace 2 workflow po restartu n8n)  
> **Cíl:** Všechny n8n workflow logují do ai_trace_events, AISHA vidí svou aktivitu

---

## Dokončeno

### 0.1 — Fix n8n Trace Logging
- [x] Migrace `20260305210000_fix_n8n_trace_logging.sql` — `log_n8n_trace_event()` auto-creates ai_run
- [x] Extended `ai_event_type` enum: `dirigent_action`, `n8n_workflow`, `escalation`, `notification`
- [x] Aplikováno na lokální DB, testováno
- [x] Migration zaregistrována (#84)

### 0.2 — Fix All Workflow Trace Nodes
- [x] WF_DIRIGENT_AGENT — Log Trace → `log_n8n_trace_event` + `p_agent_slug`
- [x] WF_COMPLIANCE_AGENT — Log Trace → `log_n8n_trace_event` + `p_agent_slug`
- [x] WF_DELIVERY_AGENT — Log Trace → `log_n8n_trace_event` + `p_agent_slug`
- [x] WF_COMPLIANCE_REROUTE — 2× opraveno (trace + escalation)
- [x] WF_MODEL_ROUTER — hardcoded JWT odstraněn, credentials reference, jsonBody format
- [x] Všech 16 workflow nasazeno na n8n.aisha.guru

### 0.3 — SoT SQL Files
- [x] `route_task.sql` — Agent pipeline router
- [x] `compose_context.sql` — Token-budgeted context builder (4 layers)
- [x] `create_ai_run.sql` — AI run lifecycle manager
- [x] `log_ai_trace_event.sql` — Original trace logger
- [x] `log_n8n_trace_event.sql` — n8n wrapper (auto-creates runs)

### 0.4 — Security Hardening
- [x] `.gitignore` fix: `.env.aisha` → `.env.aisha.example`
- [x] `.env.aisha.example` template vytvořen (bez secrets)
- [x] WF_MODEL_ROUTER hardcoded JWT odstraněn

### 0.5 — Deploy Migrace na Produkci
- [x] CI/CD pipeline automaticky aplikuje migrace (Dockerfile.migrate)
- [x] Žádný manuální krok potřeba

### 0.6 — Community Nodes Deploy (API-based)
- [x] `deploy-to-n8n.mjs` — přidána `--api` strategie (n8n REST API community packages)
- [x] `deploy-to-n8n.mjs` — přidána `--publish` strategie (npm publish + API install combo)
- [x] `n8n-nodes-aisha/package.json` — `publishConfig: { access: "public" }`
- [x] `aisha-deploy-nodes.mjs` — rozšířeno o `--api` a `--publish` strategie
- [x] `aisha-activate-watchdogs.mjs` — skript pro aktivaci watchdog workflows
- [x] npm skripty: `aisha:nodes:api`, `aisha:nodes:publish`, `aisha:watchdogs:activate`, `aisha:watchdogs:status`
- [x] `npm publish` n8n-nodes-aisha v0.3.0 na Verdaccio (npm.id3a.cz)
- [x] N8N_CUSTOM_EXTENSIONS v docker-compose (ne community packages API — ty vrací "not found", je to správně)
- [x] Self-setup.mjs v2 — credential remapping, activation retry, health verification, Supabase tracing
- [ ] Aktivace WF_ADMIN_HEALTH_MONITOR, WF_ADMIN_ORCHESTRATION (blokováno: node type neloaded, vyřeší restart)

### 0.7 — Bridge Pipeline Control
- [x] `workflowEngine.ts` — `RoutePlanHint` interface (model, tools, maxIter, compliance, humanApproval)
- [x] `workflowEngine.ts` — Risk-based model override pro primary agent (main_agent)
- [x] `workflowEngine.ts` — Tools allowlist filtering z route plan
- [x] `workflowEngine.ts` — Max tool iterations cap z route plan stop_conditions
- [x] `workflowEngine.ts` — Tracer events pro route plan overrides
- [x] `ai-chat/index.ts` — Konverze `RoutePlan` → `RoutePlanHint` (degradation-safe)
- [x] `ai-chat/index.ts` — Předání `routePlanHint` do workflow engine
- [x] Response metadata: `aisha_model_override` field
- [ ] Unifikace `agent_configurations` vs `agent_catalog` (Epocha 1 — later)

---

## Zbývá

### 0.8 — Watchdog & Monitoring
- [x] Publikace `n8n-nodes-aisha` v0.3.0 na Verdaccio (npm.id3a.cz)
- [x] Self-setup.mjs v2: credential remapping, activation retry w/ backoff, health verification, Supabase trace logging
- [x] Credential IDs opraveny na produkci (HEALTH_MONITOR + ORCHESTRATION — zombie `s8iQ8ddNCtRJclF2` + dev `Z7oSSowoqk0ZgB8X` → `bdHzQtt6YQ9XNxht`)
- [x] Credential alias map pro nekonzistentní jména (e.g., "AISHA Supabase" → "AISHA Supabase (Service Role)")
- [ ] Aktivace ADMIN_HEALTH_MONITOR + ADMIN_ORCHESTRATION (čeká na restart n8n → node types se načtou z N8N_CUSTOM_EXTENSIONS)
- [ ] Ověřit `WF_LANGFUSE_PERFORMANCE_REVIEW` funkčnost
- [ ] Nastavit WF_NIGHTLY_STORY_AUDIT schedule trigger
- [x] Propojit `ai_trace_events` s admin dashboardem (AdminAiRuns, AdminAiRunDetail, AdminAiObservability — 5 stránek, 16+ hooků)

### N8N_CUSTOM_EXTENSIONS vs Community Packages

> **Důležité:** AISHA nodes jsou loadovány přes `N8N_CUSTOM_EXTENSIONS` env var, NE přes community packages API.
>
> - `GET /api/v1/community-packages` → `{"message":"not found"}` — **toto je správné chování**, ne bug
> - Nody se loadují jako built-in při startu n8n
> - Nejsou viditelné přes API, ale jsou funkční v aktivních workflows
> - Ověření dostupnosti: pokus o aktivaci workflow → "Unrecognized node type" = nody nejsou loaded
> - Řešení: restart n8n kontejneru (entrypoint nainstaluje nodes z Verdaccio, n8n je načte)

---

## Blocker Dependencies

| Blocker | Blokuje | Řešení |
|---------|---------|--------|
| ~~Produkční migrace~~ | ~~0.5~~ | ✅ CI/CD Dockerfile.migrate |
| ~~npm publish credentials~~ | ~~0.8~~ | ✅ Verdaccio npm.id3a.cz |
| ~~N8N_API_KEY v .env.aisha~~ | ~~0.8~~ | ✅ Nastaveno v Coolify |
| n8n node type loading | 0.8 | Restart kontejneru (entrypoint install + N8N_CUSTOM_EXTENSIONS) |

---

## Navigace Masterplanu

| Epocha | Název | Status |
|--------|-------|--------|
| **0** | **Bridge** | **✅ DONE** (n8n restart pending) |
| **1** | **Sebeuvědomění (monitoring, self-healing)** | **✅ DONE** |
| **2** | **Sebezdokonalování (knowledge, evaluation, memory)** | **✅ DONE** |
| 3 | Řízení projektů (delivery engine, PR gates, negotiator) | Not started |
| 4 | Multi-Projekt (project isolation, guild, release) | Not started |
