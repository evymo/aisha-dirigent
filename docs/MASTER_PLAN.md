# MASTER_PLAN.md — Unified AISHA Platform Roadmap

> **Verze:** 3.0 | **Datum:** 2026-04  
> **Status:** ACTIVE — Alpha  
> **Repo:** [repo.id3a.cz/aisha/evymo-ai-orchestrator](https://repo.id3a.cz/aisha/evymo-ai-orchestrator)  
> **Nahrazuje:** AUTONOMY_PLAN.md, IMPLEMENTATION_PLAN.md, AISHA-Self-Managing-Organism.md (jako unified view)

---

## TL;DR

AISHA platforma se transformuje na **samoorganizující se celek** tvořený třemi vrstvami:

| Vrstva | Nástroj | Role |
|--------|---------|------|
| **Data & Analytics** | NocoDB | Analytický backend — datové struktury, views, Aisha's "hands" pro práci s daty |
| **Dashboard & UI** | Appsmith | Frontend vrstva — StoryLoop jako hlavní admin dashboard, organicky rostoucí |
| **Orchestrátor** | Aisha (n8n + MCP) | Propojovací mozek — workflow automatizace, self-healing, self-development |

**StoryLoop** se reimplementuje jako **základní admin dashboard v Appsmith**, schopný organického self-vývoje díky Aisha orchestraci.

**Priorita nasazení:** Infrastruktura FIRST → bugy paralelně → features po stabilizaci.

---

## 🎯 Vize — Aisha jako samosprávný organismus

**Aisha** je evolucí původního systému, který uměl chytře odpovídat z **několika zdrojů a několika botů podle úrovně uživatele**. Nová Aisha tuto schopnost zachovává a rozšiřuje ji o **plnou autonomii** — umí sama řídit, modifikovat a rozšiřovat celou platformu.

### Klíčové principy

1. **Aisha = Dirigent celého ekosystému.** Řídí NocoDB, Appsmith, n8n workflows, Forgejo — **sama si upravuje management board, navrhuje UI změny, vytváří nové views a dashboardy.**
2. **NocoDB ↔ Appsmith oboustranná spolupráce** pod Aišinou kontrolou. NocoDB = analytický backend a strukturální nástroj. Appsmith = frontend dashboardy. Obě komponenty spolupracují přes sdílenou PostgreSQL DB s API propojením. Aisha obsluhuje obě rozhraní — z NocoDB si čte/zapisuje analytická data, v Appsmith navrhuje a modifikuje dashboardy.
3. **Multi-source, multi-bot, user-level response** — evoluce původní Aisha architektury. Agent routing přes `agent_catalog` + `agent_configurations`, LLM Router (OpenAI/Gemini/Anthropic), kontextová odpověď podle role uživatele (member/practitioner/staff/admin).
4. **Komponisté = uživatelé platformy**, kteří se registrují na veřejném webu a zásobují Dirigenta expertními znalostmi. Public website backend kde Dirigent koordinuje celou komunitu odborníků.
5. **Referenční zákaznický projekt jako scénář** — Aisha musí být schopna **plně autonomně** (ruku v ruce s Dirigentem) doimplementovat konkrétní projekt: s individuálními agenty, rozhodovacími stromy, matching logikou. Tento scénář slouží jako důkaz funkčnosti celého systému.

### Self-Management Loop

```
Aisha detekuje potřebu → NocoDB: vytvoří/upraví view/strukturu →
Appsmith: modifikuje/vytvoří dashboard → n8n: upraví/vytvoří workflow →
Forgejo: commitne změny → Self-test → Expert approval (pokud třeba) → Deploy
```

**Aisha MUSÍ umět:**
- Modifikovat vlastní management board v NocoDB (přes NocoDB API v AishaAdminBridge)
- Navrhovat a aplikovat UI změny v Appsmith (přes Appsmith API + Git sync)
- Vytvářet/upravovat n8n workflows (přes WF_NODE_FACTORY)
- Commitovat do Forgejo (přes Git API)
- Rozhodovat o eskalaci k expertovi vs. automatické řešení
- Řídit agent_catalog a agent_configurations — přidávat nové boty, měnit routing, upravovat decision trees

### Autonomní operace po komponentách

| Komponenta | Aisha Read | Aisha Write | API |
|------------|-----------|-------------|-----|
| **NocoDB** | Views, tabulky, statistiky | Vytvářet views, upravovat struktury, zapisovat data | NocoDB REST API |
| **Appsmith** | Dashboard stav, stránky, queries | Navrhovat změny dashboardů, deploye | Appsmith REST API + Git sync |
| **n8n** | Workflow status, execution logs | Vytvářet/editovat workflows, aktivace/deaktivace | n8n REST API |
| **Forgejo** | Repozitáře, branches, PRs | Commity, branches, PR vytváření | Forgejo REST API |
| **Supabase** | Data přes RPC, schéma info | Migrace (přes soubory), seed data | PostgREST API |
| **Langfuse** | Traces, spans, metriky | Projekty, prompt management | Langfuse REST API |

---

## 🔬 Langfuse — Proč vlastní instance

**Rozhodnutí: VLASTNÍ INSTANCE (zachovat).**

n8n community node pro Langfuse je **komplementární** — pouze POSÍLÁ traces/spans DO Langfuse serveru. Nenahrazuje server samotný. Bez vlastní instance bychom museli platit Langfuse Cloud (~$59+/měsíc), nebo ztratit veškerou AI observabilitu.

Naše instance je lehká:
- Next.js aplikace na stejné Supabase PostgreSQL (`?schema=langfuse` — izolované schéma)
- Produkce: `langfuse.aisha.guru` | Lokálně: `localhost:3100`
- Init projekt: `aisha-dirigent`
- Nulové extra náklady (sdílí DB s platformou)

**Datový tok:** n8n workflows → AishaAudit node → Langfuse API → `langfuse` schema → Langfuse UI vizualizace

---

## 📊 Aktuální stav — Ground Truth (duben 2026)

### Nasazeno a funkční

| Služba | Produkce | Lokálně | Stav |
|--------|----------|---------|------|
| **Supabase** | `api.aisha.guru` | `localhost:57421` | ✅ 278 tabulek, 50 enumů, 972 funkcí, 574 indexů |
| **n8n** | `n8n.aisha.guru` | `localhost:5678` | ✅ 16 workflows, 7 community nodes |
| **NocoDB** | `nocodb.aisha.guru` | `localhost:8080` | ✅ Připojeno k Supabase PG |
| **Appsmith** | `appsmith.aisha.guru` | `localhost:8090` | ✅ Produkce + lokálně funguje |
| **Langfuse** | `langfuse.aisha.guru` | `localhost:3100` | ✅ Dual-write tracing (DB + REST) |
| **Verdaccio** | `npm.id3a.cz` | — | ✅ n8n-nodes-aisha v0.3.0 |
| **Forgejo** | `repo.id3a.cz` | — | ✅ Git mirror a CI/CD |

### Databáze — Baseline Konsolidace (2026-04-01)

32 inkrementálních migrací konsolidováno do jediné baseline (105K řádků).
Source of Truth: `supabase/sql/` — enums, tables, functions, triggers, indexes, rls, grants, views.
Marketplace stack: 12 tabulek, 7 enumů, 11 RPC funkcí, 18 indexů.

### React Admin stránky (55 aktuálně)

**AI & Monitoring (11 stránek — zůstávají v Reactu):**
- AdminOverview, AdminAiObservability, AdminAgentTools, AdminAiEvaluation, AdminAiProactive
- AdminAiRuns, AdminAiRunDetail, AdminAgentConfigurations, AdminAgentCatalog, AdminContextProfiles
- AdminMcpTokens

**Config & Security (10 stránek — zůstávají v Reactu):**
- AdminSettings, AdminRoles, AdminPermissions, AdminSessionMonitoring, AdminAuditJournal
- AdminModerationSessions, AdminStudyConsents, AdminDeletionRequests, AdminProduction
- AdminNotifications

**i18n & Content (7 stránek — zůstávají v Reactu):**
- AdminTranslations, AdminTranslationSegments, AdminTranslationAudit
- AdminBiomarkers, AdminKnowledge, AdminResources, AdminDocumentVerification

**StoryLoop & Partners (12 stránek — první kandidáti pro Appsmith dashboard):**
- AdminStoryLoop, AdminStories, AdminPartners, AdminPartnerRelations
- AdminPartnerPortfolios, AdminPartnerContracts, AdminHeroSlides
- AdminDosage, AdminProducts, AdminPrograms, AdminSurveys, AdminInstruments

**Finance & Operations (15 stránek — migrovat do Appsmith):**
- AdminPayments, AdminBankReconciliation, AdminTokenomics
- AdminOrders, AdminSubscriptionPackages, AdminMemberSubscriptions, AdminShipments
- AdminMembers, AdminConsultants, AdminDistribution, AdminDistributionProtocols
- AdminDistributionAdjustments, AdminDistributionForecast, AdminExpeditionCalendar
- AdminArchive

### n8n Workflows (16)

| Workflow | Trigger | Popis |
|----------|---------|-------|
| WF_ADMIN_HEALTH_MONITOR | ⏰ Cron (5min) + Event Gate | Event-driven monitoring — levný poll + LLM jen při změně stavu |
| WF_DIRIGENT_AGENT | 🔗 Webhook `/dirigent-agent` + Chat | Hlavní AI agent |
| WF_KNOWLEDGE_EXTRACTION | 🔗 Webhook | Extrakce znalostí |
| WF_KNOWLEDGE_SERVER | MCP | Knowledge MCP server |
| WF_DAILY_BANK_RECONCILIATION | ⏰ Cron | Bankovní párovací cron |
| WF_EVENT_DISTRIBUTOR | 🔗 Webhook | Event routing |
| WF_LANGFUSE_PERF_REVIEW | ⏰ Cron (denně 3:00) | AI performance review |
| WF_STORY_SCAFFOLD | 🔗 Webhook | Story delivery scaffolding |
| WF_NIGHTLY_STORY_AUDIT | ⏰ Cron | Story quality audit |
| WF_NODE_FACTORY | 🔗 Webhook | Dynamic workflow/node creation |
| WF_APPROVAL_GATE | 🔗 Webhook | Expert approval workflow |
| WF_PR_COMPLIANCE_GATE | 🔗 Webhook | PR quality gate |
| + 4 interní | — | Helper/utility workflows |

### Community Nodes (7) — `n8n-nodes-aisha` v0.3.0

| Node | Účel |
|------|------|
| **AishaAdminBridge** | Operace nad NocoDB, Appsmith, n8n (Aisha's hands) |
| **AishaRpc** | Volání Supabase RPC funkcí |
| **AishaAudit** | Zápis do audit_journal + Langfuse |
| **AishaTrigger** | Custom event triggers |
| **AishaStoryManager** | Story CRUD a lifecycle management |
| **AishaModelRouter** | LLM model routing (OpenAI/Gemini/Anthropic) |
| **AishaNodeFactory** | Dynamická tvorba n8n nodes/workflows |

### Agent Routing — Multi-bot architektura

| Tabulka | Účel | RPC |
|---------|------|-----|
| `agent_catalog` | Registry všech botů/agentů | `get_agent_catalog_admin`, `update_agent_catalog_admin` |
| `agent_configurations` | Flow/routing konfigurace | `get_agent_configurations_admin` |
| `context_profiles` | Kontextové profily pro agenty | Admin CRUD |

**AgentFlowDiagram.tsx** — dynamicky generuje vizuální flow diagram z `agent_configurations`.

**LLM Router** (`llmRouter.ts`, 373 řádků):
- `resolveProvider()` — gemini-* → Google, claude-* → Anthropic, else → OpenAI
- `unifiedChat()` — hlavní entry point
- `isReasoningModel()` — o1/o3/o4/gpt-5 special handling
- Používá: ai-chat, ai-story-consult, mcp-knowledge-server

**Smart Model Auto-Selection** (`orchestrationBridge.ts`):
- `classifyMessageComplexity()` — heuristická klasifikace (greeting → deep_analysis)
- `selectOptimalModel()` — adaptivní výběr modelu z `ai_model_registry`
- Dva zdroje: Registry (RPC `get_adaptive_model_tiers()`) → fallback (hardcoded)
- Aisha si sama zjišťuje modely (`discover-models`), testuje, vyhodnocuje a adaptuje
- Risk escalation: compliance/approval → minimum `complex` tier

**AI Model Registry & Discovery**:
- `ai_model_registry` — 26 sloupců: provider, model_id, capabilities, pricing, eval scores
- `discover-models` Edge Function — denní scan OpenAI, Anthropic, Google, xAI
- `ai_model_benchmarks` — evaluační výsledky (overall_score, latency, cost, safety)
- Pipeline: Discovery → Registry → Eval → Benchmarks → Adaptive Tiers → `selectOptimalModel()`

### Orchestration Bridge (`orchestrationBridge.ts` v0.2.0)

Phase 0 bridge: Edge Function → orchestrationBridge → Supabase RPC / n8n webhook → Dirigent Agent → toolCode nodes → MCP Server. Architektura Option C — Individual toolCode nodes volající MCP via fetch (JSON-RPC 2.0).

### Referenční zákaznický projekt

- Port range: `543xx` (v `supabase/config.toml`)
- Migrace: per-tenant token/voucher migrace (mimo veřejný repozitář)
- Agent routing: přes `agent_catalog` + `agent_configurations` tabulky
- **Cílový stav:** Aisha autonomně doimplementuje celý projekt — agenty, decision trees, matching, delivery flow

---

## 🏥 Health Monitor & Monitoring Admin

### Architektura — Event-Driven Escalation Pattern

**Princip:** Levné lokální checky (5 min poll) → State Change Detection → LLM/webhooky POUZE při přechodu stavu.

```
Cron 5min → Config Gate → Check Services → Parse Results
    ├─ Update Health Status (VŽDY, levný DB write)
    └─ Detect State Change (porovná se static data)
        ├─ Nic se nezměnilo → STOP (0 tokenů, 0 webhooků)
        └─ Stav se změnil → EVENT!
            ├─ Log State Transition (DB, vždy při změně)
            └─ Has New Issues?
                ├─ ANO → Self-Healing + Notify Dirigent (tokeny JEN TEĎ)
                └─ NE (jen recovery) → hotovo, zalogováno
```

**Klíčové vlastnosti:**
- **Zero tokens** při stabilním stavu — Dirigent dostane webhook POUZE při přechodu stavu (healthy↔degraded↔down)
- **State Change Detector** porovnává aktuální snapshot s `$getWorkflowStaticData('global').lastKnownHealthState`
- **Circuit Breaker** — max 3 recovery pokusy/službu/hodinu, pak eskalace k expertovi
- **Config Gate** — čte `monitoring_config` z `system_config` tabulky, admin toggle enabled/disabled
- **Workflow Drift** — odstraněn (byl stub bez HTTP přístupu v Code node sandbox)

### Self-Design Pattern pro Aishu

Tento pattern je **referenční architektura** pro všechny monitorovací/analytické workflows:

1. **Poll cheaply** — časté lehké lokální checky (HTTP ping, DB read)
2. **Store state** — `$getWorkflowStaticData('global')` persistuje mezi běhy
3. **Detect transitions** — porovnej aktuální vs uložený stav
4. **Escalate on events only** — LLM/webhook volání jen při skutečné změně

Aisha by měla tento pattern replikovat přes WF_NODE_FACTORY při vytváření nových workflows.

### WF_ADMIN_HEALTH_MONITOR (16 nodes)

| Node | Typ | Kdy běží | Cena |
|------|-----|----------|------|
| Every 5 Minutes | Cron `*/5` | Vždy | Žádná |
| Read Monitoring Config | AishaRpc | Vždy | 1× DB read |
| Config Gate | Code | Vždy | Lokální |
| Check All Services | AdminBridge | Pokud enabled | HTTP pingy |
| Parse Health Results | Code | Pokud enabled | Lokální |
| Update Health Status | AishaRpc | Pokud enabled | 1× DB write |
| **Detect State Change** | **Code** | **Pokud enabled** | **Lokální — EVENT GATE** |
| Log State Transition | AishaRpc | Jen při změně | 1× DB write |
| Has New Issues? | IF | Jen při změně | Lokální |
| Self-Healing Logic | Code | Jen nové issues | Lokální |
| Notify Dirigent | HTTP | **Jen nové issues** | **LLM tokeny** |
| Needs Recovery? | IF | Jen nové issues | Lokální |
| Attempt Recovery | Code | Jen při recovery | Lokální |
| Log Recovery | AishaRpc | Jen při recovery | 1× DB write |
| Needs Escalation? | IF | Jen nové issues | Lokální |
| Escalate to Expert | HTTP | **Jen circuit break** | **Webhook** |

**Token savings:** Při stabilním stavu (nejčastější případ) = 0 LLM tokenů / run.
Tokeny jen při přechodu stavu → řádově nižší spotřeba vs polling-based evaluace.

### Admin UI pro monitoring

Implementováno v `useMonitoringConfig` hook + AdminAiProactive stránka:

| Funkce | Implementace | Stav |
|--------|-------------|------|
| **On/Off toggle** | `monitoring_config.health_enabled` v `system_config` | ✅ |
| **Status indikátor** | `useMonitoringConfig` hook | ✅ |
| **Last execution** | n8n API: `GET /executions?workflowId={id}&limit=1` | Plánováno |
| **Health history** | `integration_actions` tabulka (log_integration_action) | ✅ (via state transitions) |

---

## 🐛 Známé bugy — Prioritizováno

| # | Bug | Priorita | Soubor | Stav |
|---|-----|----------|--------|------|
| 1 | **TOCTOU v update_story_status_audited** — ownership check oddělen od UPDATE | 🔴 KRITICKÁ | `update_story_status_audited.sql` | ✅ OPRAVENO — `FOR UPDATE` lock (commit `1c6c142`) |
| 2 | **Dead block actions** — Accept/Assign/Reject/Reschedule tlačítka nejsou napojené | 🔴 VYSOKÁ | `StoryDetail*.tsx` | ✅ IMPLEMENTOVÁNO — celý řetěz StoryDetail → StoryEntryBlockRenderer → Block komponenty → useStoryBlockActions → `respond_to_story_block_audited` RPC je napojen. 7 block typů, 5 RPC akcí. |
| 3 | **Deep link notifikací** — směřuje na diary místo StoryLoop workspace | 🟡 STŘEDNÍ | `buildMemberStoryEntryLink()` | ✅ IMPLEMENTOVÁNO — `buildMemberStoryEntryLink` generuje `/member/story?view=stories&story=X&post=Y`, router + MemberStory parsuje parametry správně, NotificationCenter naviguje na `notification.link`. |
| 4 | **AI panel ztráta konverzace** — `useState` místo server persistence | 🟡 STŘEDNÍ | `AishaConsultPanel.tsx` | ✅ IMPLEMENTOVÁNO — `useStoryAiConsult` má plnou server persistenci: conversation via `edge_story_ai`, messages via `get_chat_messages_audited`, send via `ai-story-consult`. React Query caching + optimistic updates. |
| 5 | **`edge_story_ai` široký GRANT** — authenticated může vytvářet AI sessions | 🟡 SECURITY | `edge_story_ai.sql` | ✅ REVIEW OK — interní auth kontroly (user mismatch prevention, story access via partner_stories, admin bypass) jsou korektní. |
| 6 | **Chybějící paginace stories** — limit 50, žádný cursor | 🟡 STŘEDNÍ | `useStories` hook | ✅ OPRAVENO — `useInfiniteStories` offset-based `useInfiniteQuery` (PAGE_SIZE=30) + IntersectionObserver infinite scroll v `StoryList.tsx` (commit `8656f0e`) |
| 7 | **Template Builder bez persistence** — nejasné kam se ukládají templates | 🟡 NÍZKÁ | `PartnerTemplateBuilder.tsx` | ✅ IMPLEMENTOVÁNO — Persistence existovala: `partner_templates` tabulka + `save_partner_template`/`get_partner_templates`/`delete_partner_template` RPC. Doplněn audit logging přes `write_audit_journal`. |
| 8 | **Reminders bez aktivní notifikace** — pasivní UI-only | 🟡 NÍZKÁ | `story_reminders` | ✅ OPRAVENO — `process_due_story_reminders()` SECURITY DEFINER (FOR UPDATE SKIP LOCKED), vytvoří notifikaci + audit_journal. n8n cron workflow `WF_STORY_REMINDER_CRON.json` každých 5 min (commit `424afd3`). |

---

## 🏗️ Pořadí realizace — Unified Timeline

### Fáze 0: Appsmith Deploy (1-2 dny) 🚀

**Cíl:** Appsmith běží na Coolify + lokálně, připojeno k Supabase DB.

**Appsmith = frontend dashboard vrstva.** Zde vznikne StoryLoop admin dashboard a postupně všech 15+ operačních/finančních dashboardů. Appsmith je zároveň canvas pro Aishine autonomní UI modifikace.

#### 0.1 Docker Compose — lokální vývoj

```yaml
# Implementováno v docker-compose.local.yml (profile: admin)
# MongoDB vyžaduje --replSet rs0 + healthcheck s rs.initiate()
# Viz commit 4942b63 + 511dfc4
appsmith:
  image: appsmith/appsmith-ce:latest
  ports:
    - "8090:80"
  volumes:
    - appsmith_data:/appsmith-stacks
  environment:
    - APPSMITH_MONGODB_URI=mongodb://appsmith-mongo:27017/appsmith
    - APPSMITH_ENCRYPTION_PASSWORD=${APPSMITH_ENCRYPTION_PASSWORD:-change-in-production}
    - APPSMITH_ENCRYPTION_SALT=${APPSMITH_ENCRYPTION_SALT:-change-in-production}
  depends_on:
    appsmith-mongo:
      condition: service_healthy  # ← čeká na replica set init
  restart: unless-stopped
  profiles: ["full", "admin"]

appsmith-mongo:
  image: mongo:7
  command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]  # ← REQUIRED
  volumes:
    - appsmith_mongo_data:/data/db
  healthcheck:  # ← auto rs.initiate() na prvním bootu
    test: ["CMD", "mongosh", "--quiet", "--eval", "try{rs.status()}catch(e){rs.initiate();rs.status()}"]
    interval: 10s
    retries: 10
    start_period: 30s
  restart: unless-stopped
  profiles: ["full", "admin"]
```

#### 0.2 Coolify Deploy — produkce

- [x] Appsmith + MongoDB sidecar v `docker-compose.coolify-admin.yml` (separátní stack)
- [x] Traefik labels pro `appsmith.aisha.guru` (HTTPS + redirect) — Coolify auto-generated
- [x] Env vars: `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT`
- [x] ✅ **Appsmith produkčně funguje** — `appsmith.aisha.guru` vrací 200, Admin stack `running:healthy`

#### 0.3 Připojení k datovým zdrojům

- [x] **Supabase PostgreSQL** — lokální datasource (DS ID: `69abf9358b5c8e4325ca73c1`, connection test ✅)
- [ ] **Supabase PostgreSQL** — produkční datasource (po fixu 503)
- [ ] **NocoDB API** — pro analytické views (`nocodb.aisha.guru` API token)
- [ ] **n8n Webhook** — pro workflow triggering (`n8n.aisha.guru/webhook/...`)
- [ ] **Langfuse API** — pro AI metrics (`langfuse.aisha.guru`)

#### 0.4 Workspace + Git sync

- [x] Vytvořit workspace `AISHA` v Appsmith — lokálně (WS ID: `69abf7f68b5c8e4325ca73bd`)
- [x] **StoryLoop Admin** app vytvořen — lokálně (App ID: `69abf93b8b5c8e4325ca73c3`)
- [x] Setup skript: `scripts/appsmith-api-setup.py` (idempotentní — detekuje existující resources)
- [ ] Zopakovat workspace/datasource setup na produkci (po fixu 503)
- [ ] Nastavit Git sync (Forgejo/GitHub) pro version control dashboardů
- [ ] RBAC: Admin role → full access, Staff/Dirigent → view + limited edit
- [ ] **Appsmith API token** pro Aisha (AishaAdminBridge) — Aisha bude přes API modifikovat dashboardy

#### Deliverables
- [x] Appsmith lokálně na `localhost:8090` (admin: `$APPSMITH_ADMIN_EMAIL`)
- [x] ✅ Appsmith produkčně na `appsmith.aisha.guru` — 200, Admin stack `running:healthy`
- [x] Připojeno k Supabase lokálně (connection test ✅)
- [ ] Připojeno k NocoDB, n8n, Langfuse
- [x] Workspace `AISHA` s StoryLoop Admin app (lokálně)
- [ ] Git sync
- [ ] Appsmith API token pro Aisha

---

### Fáze 1: Forgejo Connect + StoryLoop Dashboard Design (2-3 dny)

**Cíl:** Forgejo jako mirror/backup propojeno, StoryLoop dashboard navržen v Appsmith.

#### 1.1 Forgejo — stav

- [x] Forgejo nasazeno na `repo.id3a.cz` ✅ (Forgejo je primary Git, ne mirror)
- [x] Organizace `aisha` vytvořena ✅ (repo: `aisha/evymo-ai-orchestrator`)
- [ ] Mirror z GitHub (Forgejo je primary, GitHub mirror nepotřeba)
- [ ] Appsmith Git sync → Forgejo (`evymo/appsmith-configs`)
- [ ] n8n workflow export → Forgejo (`evymo/n8n-workflows`)

#### 1.2 StoryLoop Admin Dashboard — Design v Appsmith

StoryLoop dashboard v Appsmith nahrazuje `AdminStoryLoop.tsx` a rozšiřuje scope:

**Dashboard sekce:**

| Sekce | Data zdroj | Vizualizace |
|-------|------------|-------------|
| **Story Overview** | Supabase RPC `get_storyloop_admin_overview` | KPI karty, status distribuce |
| **Stories Grid** | Supabase RPC `get_my_stories_audited` s admin scope | Tabulka s filtrováním, bulk akce |
| **Story Detail** | Supabase RPC `get_story_detail_audited` | Side panel s entries timeline |
| **Block Actions** | Supabase RPC (meeting/questionnaire/consent/lab) | Akční formuláře — FIX mrtvých tlačítek! |
| **AI Sessions** | Supabase `story_ai_sessions` | Přehled AI konzultací |
| **Reminders** | Supabase `story_reminders` | Upcoming/overdue reminders |
| **Knowledge Base** | Supabase `knowledge_topics` + `knowledge_posts` | Topic management |
| **Templates** | Supabase (template persistence) | Template builder |
| **Analytics** | NocoDB views + Langfuse | Story completion rates, AI usage |
| **Monitoring** | WF_ADMIN_HEALTH_MONITOR data | On/Off toggle, interval config, health history |

**Klíčový princip:** Dashboard volá Supabase RPC funkce (ne `.from()`) → respektuje RLS a auditní trail.

#### 1.3 NocoDB jako analytický backend + Aisha self-management

NocoDB NENAHRAZUJE admin stránky přímo — slouží jako:

1. **Analytická vrstva** — views nad Supabase daty pro reporting a pattern detection
2. **Strukturální nástroj** — rychlé vytváření nových datových struktur bez migrací
3. **Aisha's backend interface** — Aisha čte/zapisuje data přes NocoDB API (via AishaAdminBridge)
4. **Data exploration** — spreadsheet interface pro Dirigenta (rychlý přehled/editace)
5. **Self-management board** — Aisha si sama vytváří a modifikuje views pro svou operativu

**NocoDB views k vytvoření:**

| View | Supabase tabulka | Účel |
|------|-----------------|------|
| `stories_overview` | `partner_stories` | Admin grid se statusy, prioritami, assignees |
| `story_entries_log` | `story_entries` | Timeline všech entries |
| `ai_sessions_audit` | `story_ai_sessions` | AI usage patterns |
| `reminders_board` | `story_reminders` (kanban) | Upcoming/overdue/completed |
| `knowledge_topics` | `knowledge_topics` | Topic management |
| `block_responses` | Entry metadata | Response rates per block type |
| `user_activity` | Cross-table join | Activity heatmap |
| `integration_health` | `integration_services` | Service health dashboard |
| `aisha_operations_log` | Nová tabulka | Aisha self-management log |
| `agent_routing_overview` | `agent_catalog` + `agent_configurations` | Multi-bot routing overview |

#### Deliverables
- [ ] Forgejo deployed a propojeno (mirror, Git sync)
- [ ] StoryLoop dashboard wireframe v Appsmith
- [ ] NocoDB analytické views vytvořeny (10+ views)
- [ ] Appsmith ↔ NocoDB datasource propojení
- [ ] Aisha operations log tabulka/view

---

### Fáze 2: StoryLoop Implementation + Security Fixes + Aisha Autonomy (3-5 dní)

**Cíl:** Funkční StoryLoop dashboard v Appsmith + opravené kritické bugy + Aisha řídí NocoDB/Appsmith.

#### 2.1 Appsmith StoryLoop Dashboard — Implementace

1. **Story Overview** — KPI karty + status chart
2. **Stories Grid** — filtrovatelná tabulka s inline editing
3. **Story Detail Panel** — entries timeline, metadata
4. **Block Action Forms** — Accept/Decline/Reschedule formuláře (oprava mrtvých tlačítek!)
5. **AI Sessions Viewer** — session replay, context inspector
6. **Monitoring Panel** — Health Monitor toggle, interval, history
7. **Integrace s n8n** — workflow triggery přes webhook buttons

#### 2.2 Security Fixes (paralelně)

```sql
-- Fix #1: TOCTOU v update_story_status_audited
UPDATE partner_stories 
SET status = p_new_status 
WHERE id = p_story_id 
  AND (partner_id = v_partner_id OR client_id = v_user_id);

-- Fix #5: Restrict edge_story_ai
REVOKE EXECUTE ON FUNCTION edge_story_ai FROM authenticated;
-- Nová funkce s proper authorization
```

#### 2.3 Bugfixy (paralelně)

- [x] Dead block actions ✅ (celý řetěz StoryDetail → StoryEntryBlockRenderer → Block → useStoryBlockActions → RPC napojen)
- [x] Deep link notifikací ✅ (`buildMemberStoryEntryLink` → `/member/story?view=stories&story=X&post=Y`)
- [x] AI panel persistence ✅ (`useStoryAiConsult` — server persistence přes `edge_story_ai` + `get_chat_messages_audited`)

#### 2.4 Aisha Autonomní Operace — AishaAdminBridge rozšíření

Rozšířit `AishaAdminBridge` node o plnou kontrolu nad NocoDB a Appsmith:

**NocoDB operace (Aisha self-management):**

| Operace | Popis |
|---------|-------|
| `nocodb_list_tables` | Seznam tabulek/views |
| `nocodb_create_view` | Vytvořit nový view |
| `nocodb_update_view` | Upravit existující view |
| `nocodb_read_rows` | Číst data z view/tabulky |
| `nocodb_write_rows` | Zapisovat data |
| `nocodb_create_table` | Vytvořit novou tabulku |

**Appsmith operace (Aisha UI management):**

| Operace | Popis |
|---------|-------|
| `appsmith_list_pages` | Seznam stránek/dashboardů |
| `appsmith_get_page` | Detail stránky včetně widgetů |
| `appsmith_update_page` | Upravit stránku |
| `appsmith_deploy` | Deploy změn |
| `appsmith_git_commit` | Commitnout změny do Git |
| `appsmith_trigger_query` | Spustit Appsmith query |

**Nové MCP tools:**
- `admin_nocodb_manage` ✅ — NocoDB CRUD operace pro Aisha
- `admin_appsmith_manage` ✅ — Appsmith dashboard management (safe subset)
- `admin_appsmith` ✅ — Appsmith full management (5 operací)
- `admin_monitoring_config` — ❌ neimplementováno (monitoring config se řeší přes React `useMonitoringConfig` hook)

#### Deliverables
- [ ] StoryLoop Dashboard funkční v Appsmith
- [x] Security fixes deployed ✅ (TOCTOU FOR UPDATE lock, commit `1c6c142`)
- [x] AishaAdminBridge: NocoDB operace (8) ✅
- [x] AishaAdminBridge: Appsmith operace (5) ✅ (`executeAppsmithOps()`)
- [x] Monitoring admin panel (On/Off, interval) ✅ (`useMonitoringConfig` + `AdminAiProactive`)
- [x] MCP tools pro NocoDB/Appsmith ✅ (Monitoring config chybí jako MCP tool)

---

### Fáze 3: Financial & Operations Dashboardy (3-5 dní)

**Cíl:** 15 operačních/finančních admin stránek migrovány z React do Appsmith.

#### Finanční dashboardy (7)

| Dashboard | Nahrazuje React stránku | Data |
|-----------|------------------------|------|
| Payments Overview | AdminPayments | `payments`, `orders` |
| Bank Reconciliation | AdminBankReconciliation | `bank_transactions`, `payments` |
| Tokenomics | AdminTokenomics | `token_transactions`, `accounts` |
| Orders | AdminOrders | `orders`, `order_items` |
| Subscriptions | AdminSubscriptionPackages + AdminMemberSubscriptions | `subscription_packages`, `member_subscriptions` |
| Shipments | AdminShipments | `shipments`, `orders` |
| Distribution Forecast | AdminDistributionForecast | `distribution_protocols`, forecasting |

#### Operační dashboardy (8)

| Dashboard | Nahrazuje React stránku | Data |
|-----------|------------------------|------|
| Members | AdminMembers | `profiles`, `member_*` |
| Partners | AdminPartners | `partner_profiles`, `partner_*` |
| Consultants | AdminConsultants | `partner_profiles` (consultant role) |
| Distribution | AdminDistribution | `distributions`, `distribution_protocols` |
| Distribution Protocols | AdminDistributionProtocols | `distribution_protocols` |
| Distribution Adjustments | AdminDistributionAdjustments | `distribution_adjustments` |
| Expedition Calendar | AdminExpeditionCalendar | `expeditions`, scheduling |

#### Migrační strategie — Dual Mode

```
React Admin (stávající)     Appsmith (nové)
━━━━━━━━━━━━━━━━━━━━━━━     ━━━━━━━━━━━━━━━━
AdminPayments           ←→  Appsmith Payments Dashboard
   | obě pracují se         |
   | stejnou Supabase DB    |
   └────────────────────────┘

Krok 1: Appsmith dashboard paralelně s React
Krok 2: React stránka → deprecation redirect
Krok 3: Odstranění React kódu po validaci
```

#### Deliverables
- [ ] 7 finančních dashboardů v Appsmith
- [ ] 8 operačních dashboardů v Appsmith
- [ ] Dual mode testován
- [ ] React deprecation redirecty připraveny

---

### Fáze 4: Knowledge Graph + Multi-Bot Evolution (2-3 dny)

**Cíl:** Unified knowledge model pro Aisha + evoluce multi-bot architektury. Z IMPLEMENTATION_PLAN Fáze 1.

#### 4.1 Knowledge Graph tabulky

```sql
CREATE TABLE knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,  -- 'expert_rule', 'story_entry', 'discussion', 'document', 'composer_input'
  source_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  category text,
  tags text[],
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  token_count int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  model text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

#### 4.2 Multi-Bot evoluce — referenční zákaznický scénář

Rozšíření `agent_catalog` a `agent_configurations` pro plně autonomní implementaci:

```sql
ALTER TABLE agent_catalog ADD COLUMN IF NOT EXISTS decision_tree jsonb;
ALTER TABLE agent_catalog ADD COLUMN IF NOT EXISTS project_scope text[];
ALTER TABLE agent_catalog ADD COLUMN IF NOT EXISTS autonomy_level text;  -- 'manual', 'semi', 'full'

CREATE TABLE agent_decision_trees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agent_catalog(id),
  tree_name text NOT NULL,
  tree_definition jsonb NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Referenční projekt — implementační flow:**
1. Aisha analyzuje projekt scope přes knowledge_items
2. Vytvoří potřebné agenty v agent_catalog (přes AishaAdminBridge → NocoDB)
3. Nakonfiguruje decision trees pro routing
4. Implementuje matching logiku přes n8n workflow
5. Otestuje autonomně, eskaluje k expertovi
6. Deploy

#### 4.3 NocoDB/Appsmith views

- Knowledge Explorer — full-text + semantic search (Appsmith)
- Agent Decision Trees — vizuální editor (Appsmith + AgentFlowDiagram logika)
- Knowledge Sources — coverage map (NocoDB view)
- Embedding Status — processing queue (NocoDB view)

#### Deliverables
- [x] Migrace: knowledge_items, knowledge_chunks, knowledge_embeddings ✅ (tabulky existují v DB, baseline + types.ts)
- [ ] Migrace: agent_decision_trees + agent_catalog rozšíření
- [x] MCP tool: `search_knowledge_v2` (vector + full-text) ✅ (implementováno v mcp-knowledge-server)
- [ ] Referenční projekt — agent routing nakonfigurován
- [ ] NocoDB views + Appsmith dashboardy pro knowledge/agents

---

### Fáze 5: Story Delivery Context + Orchestrace (3-5 dní)

**Cíl:** Story delivery state machine, rulesets, participants. Z IMPLEMENTATION_PLAN Fáze 2+5.

#### 5.1 Story rozšíření

```sql
ALTER TABLE partner_stories ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE partner_stories ADD COLUMN IF NOT EXISTS checkout_metadata jsonb;

CREATE TABLE story_rulesets (...);
CREATE TABLE story_contexts (...);
CREATE TABLE story_participants (...);
CREATE TABLE story_environments (...);
```

#### 5.2 Delivery State Machine

```
analyzing → matched → scaffolding → ready → in_progress → qa → delivering → delivered
```

Aisha orchestruje přechody přes n8n workflow `WF_STORY_SCAFFOLD`.

#### 5.3 StoryLoop Flow

1. Request → `story_entries(entry_type='storyloop_request')`
2. Match → `mcp_match_experts` → guild experts
3. Create → `create_story_audited(origin='storyloop')`
4. Assign → `story_participants(role='guild_expert')`
5. Work → entries, tasks, AI sessions
6. Deliver → story completed

#### Deliverables
- [x] Migrace: story_rulesets, story_contexts, story_participants, story_environments ✅ (tabulky existují v DB, baseline + types.ts)
- [ ] Delivery state machine v Aisha
- [ ] StoryLoop flow implementace
- [ ] n8n WF_STORY_SCAFFOLD rozšíření
- [ ] Appsmith Story Delivery Tracker dashboard

---

### Fáze 6: Accounts + Entitlements + Guild (3-5 dní)

**Cíl:** Finanční vrstva + guild formalizace. Z IMPLEMENTATION_PLAN Fáze 4+6.

#### 6.1 Accounts & Entitlements

```sql
CREATE TABLE accounts (...);
CREATE TABLE entitlements (...);
```

#### 6.2 Guild Formalizace

```sql
CREATE TABLE guild_memberships (...);
CREATE TABLE consultations (...);
```

#### 6.3 Workflows

- WF_GUILD_APPLICATION_EVALUATE
- WF_GUILD_STORYLOOP_MATCH_AND_ASSIGN
- WF_NIGHTLY_STORY_AUDIT (rozšíření)

#### Deliverables
- [ ] Migrace: accounts, entitlements, guild_memberships, consultations
- [ ] Guild dashboard v Appsmith
- [ ] Financial reporting v Appsmith
- [ ] n8n guild workflows

---

### Fáze 7: Aisha Toolkit — Uzavření autonomní smyčky (5-8 dní)

**Cíl:** Přeměnit Aishu z reaktivního agenta (~30% autonomie) na plně self-managing organismus (~90%) uzavřením 6 kritických mezer identifikovaných auditem z 2026-03-09.

**Audit zjištění (stav před Fází 7):**

| Gap | Stav | Dopad |
|-----|------|-------|
| Rule propagation | ✅ DB trigger + notification implementovány | trg_expert_rule_propagation, fn_notify_rule_change(), pg_notify |
| Forgejo/Git operace | ✅ admin_forgejo_git MCP tool | Aisha commituje, vytváří PR, merguje přes MCP |
| Appsmith API | ✅ admin_appsmith MCP tool | Aisha modifikuje dashboardy, deploye, git sync |
| Proaktivní workflows | ✅ Watchdogs rozšířeny (+3 WF) | Nightly audit, reminders, guild match, story scaffold aktivovány |
| Self-learning loop | ✅ WF_SELF_LEARNING_LOOP implementován | Proposal → branch → PR → compliance gate, rate-limited 3 PR/h |
| Expert rule → copilot-instructions | ✅ RPC + trigger hotové | generate_copilot_instructions() v MCP, trigger notifikuje změny |

#### 7.1 Module 1: Rule Propagation Engine

**Problém:** Změna v `expert_rules` (publish/archive/update) se nikam nepromítne — fingerprint v `story_rulesets` zastarává, `copilot-instructions.md` je statický.

**Řešení:** DB trigger → notification → n8n webhook → kaskáda akcí.

```sql
-- Trigger na expert_rules tabulce
CREATE TRIGGER trg_expert_rule_propagation
  AFTER INSERT OR UPDATE OR DELETE ON expert_rules
  FOR EACH ROW EXECUTE FUNCTION fn_notify_rule_change();

-- Notification function
fn_notify_rule_change():
  1. pg_notify('expert_rule_changed', payload)
  2. INSERT INTO ai_trace_events (event='rule_propagation_triggered')
  3. Volitelně: HTTP webhook na n8n
```

**Propagační kaskáda:**
```
expert_rules changed
  ├── 1. Recalculate story_rulesets fingerprint
  │     └── UPDATE story_rulesets SET fingerprint = md5(...)
  ├── 2. Invalidate compose_context cache
  │     └── DELETE FROM context_cache WHERE ruleset_id = ...
  ├── 3. Notify n8n (pg_notify → LISTEN nebo webhook)
  │     └── WF_RULE_PROPAGATION workflow
  └── 4. Regenerate copilot-instructions.md
        └── Edge function nebo n8n → MCP generate_copilot_instructions
```

**Deliverables:**
- [x] `fn_notify_rule_change()` — PostgreSQL trigger function ✅ (implementováno jako `notify_expert_rules_changed()` v migraci `20260310090000`)
- [x] `trg_expert_rule_propagation` — trigger na expert_rules ✅ (trigger `trg_expert_rules_change_notification` v migraci)
- [x] `fn_recalculate_ruleset_fingerprint()` — helper pro přepočet ✅ (migrace `20260309144357`, volaná z `fn_notify_rule_change()`)
- [x] n8n `WF_RULE_PROPAGATION` workflow (webhook → kaskáda) ✅ (existuje v `n8n/workflows/WF_RULE_PROPAGATION.json`)
- [x] pg_net webhook bridge ✅ (migrace `20260311090000` — `net.http_post()` na n8n webhook, graceful fallback)
- [ ] E2E test: změna expert_rule → ověření nového fingerpritu

#### 7.2 Module 2: Forgejo Bridge

**Problém:** Aisha nemá žádný kód pro Git operace. `AishaAdminBridge` má NocoDB (8 ops) + Langfuse (6 ops) + Health (2 ops), ale ZERO Forgejo.

**Řešení:** Rozšířit `AishaAdminBridge` o Forgejo operace + MCP tools.

**Forgejo API operace (6):**

| Operace | Forgejo API endpoint | MCP tool |
|---------|---------------------|----------|
| `list_repos` | `GET /api/v1/repos/search` | `forgejo_list_repos` |
| `create_branch` | `POST /api/v1/repos/{owner}/{repo}/branches` | `forgejo_create_branch` |
| `commit_file` | `POST /api/v1/repos/{owner}/{repo}/contents/{path}` | `forgejo_commit_file` |
| `create_pr` | `POST /api/v1/repos/{owner}/{repo}/pulls` | `forgejo_create_pr` |
| `get_diff` | `GET /api/v1/repos/{owner}/{repo}/pulls/{id}/files` | `forgejo_get_diff` |
| `merge_pr` | `POST /api/v1/repos/{owner}/{repo}/pulls/{id}/merge` | `forgejo_merge_pr` |

**Credential management:**
- Forgejo API token uložen v n8n credentials
- Base URL: `https://git.id3a.cz/api/v1`
- Auth: `Authorization: token {FORGEJO_TOKEN}`

**Deliverables:**
- [x] `AishaAdminBridge` rozšířen o `forgejo` service (6 operací) ✅ (implementováno v AishaAdminBridge.node.ts)
- [x] MCP tools: `forgejo_*` (6 nástrojů) ✅ (implementováno jako `admin_forgejo_git` v mcp-knowledge-server, commit `3395682`)
- [x] n8n credential type: `AishaForgejoApi` ✅ (implementováno v AishaForgejoApi.credentials.ts)
- [ ] E2E test: create_branch → commit_file → create_pr pipeline

#### 7.3 Module 3: Appsmith Connector

**Problém:** Appsmith běží na `appsmith.aisha.guru`, ale Aisha nemá žádné API volání.

**Řešení:** Rozšířit `AishaAdminBridge` o Appsmith REST API operace.

**Appsmith API operace (5):**

| Operace | Appsmith API endpoint | MCP tool |
|---------|----------------------|----------|
| `list_pages` | `GET /api/v1/pages?applicationId=...` | `appsmith_list_pages` |
| `get_page` | `GET /api/v1/pages/{id}` | `appsmith_get_page` |
| `update_page` | `PUT /api/v1/pages/{id}` | `appsmith_update_page` |
| `deploy_app` | `POST /api/v1/applications/deploy/{id}` | `appsmith_deploy_app` |
| `git_sync` | `POST /api/v1/git/push/{appId}` | `appsmith_git_sync` |

**Deliverables:**
- [x] `AishaAdminBridge` rozšířen o `appsmith` service (5 operací) ✅ (implementováno v AishaAdminBridge.node.ts — `executeAppsmithOps()`)
- [x] MCP tools: `admin_appsmith` + `admin_appsmith_manage` (5+4 operací) ✅ (implementováno v mcp-knowledge-server)
- [x] n8n credential type: `AishaAppsmithApi` ✅ (implementováno v AishaAppsmithApi.credentials.ts)
- [ ] E2E test: list_pages → update_page → deploy_app pipeline

#### 7.4 Module 4: Proactive Activation

**Problém:** Klíčové cron/scheduled workflows existují ale jsou NEAKTIVNÍ v n8n.

**Workflows k aktivaci:**

| Workflow | Trigger | Účel | Stav |
|----------|---------|------|------|
| `WF_NIGHTLY_STORY_AUDIT` | Cron 2:00 UTC | Kontrola story progress, stale stories | ⏸️ Inactive |
| `WF_STORY_REMINDER_CRON` | Cron 8:00 UTC | Připomínky pro assignees | ⏸️ Inactive |
| `WF_EXPERT_NOTIFICATION` | Webhook/Cron | Notifikace expertům o nových rules | ⏸️ Inactive |
| `WF_ADMIN_HEALTH_MONITOR` | Cron 5min | System health check, alert escalation | ⏸️ Inactive |
| `WF_RULE_PROPAGATION` | Webhook | Nový — z Module 1 | 🆕 New |

**Aktivační sekvence:**
1. Ověřit že každý WF má správné credentials
2. Aktivovat v pořadí: Health Monitor → Nightly Audit → Reminder → Expert Notification
3. Monitorovat první run cyklus v Langfuse

**Deliverables:**
- [x] Všechny 4 existující workflows JSON vytvořeny ✅ (WF_NIGHTLY_STORY_AUDIT, WF_STORY_REMINDER_CRON, WF_EXPERT_NOTIFICATION, WF_ADMIN_HEALTH_MONITOR)
- [x] WF_RULE_PROPAGATION vytvořen ✅ (JSON v n8n/workflows/)
- [ ] Monitoring dashlet pro WF health v Appsmith (Health Monitor používá NocoDB + Supabase, ne Appsmith)
- [x] Alert escalation ✅ (circuit breaker v Health Monitor — 3 pokusy/h, pak eskalace k expertovi; severity routing v WF_EXPERT_NOTIFICATION)

#### 7.5 Module 5: Self-Learning Loop Closer

**Problém:** Aisha umí detekovat problémy (Langfuse, health monitor) a navrhnout řešení, ale neumí je implementovat end-to-end.

**Target flow:**
```
Detection (Langfuse/Monitor)
  │
  ▼
Analysis (WF_DIRIGENT decision tree)
  │
  ▼
Proposal (ai_trace_events: event='improvement_proposal')
  │
  ▼
Branch (Module 2: forgejo_create_branch)
  │
  ▼
Implementation (n8n + MCP tools)
  │
  ▼
Commit (Module 2: forgejo_commit_file)
  │
  ▼
PR (Module 2: forgejo_create_pr)
  │
  ▼
Compliance Gate (WF_PR_COMPLIANCE_GATE)
  │
  ▼
Expert Approval (if risk > threshold)
  │  ├── low_risk: auto-merge
  │  ├── medium_risk: require 1 approval
  │  └── high_risk: require expert + admin
  │
  ▼
Merge + Deploy (forgejo_merge_pr → WF_SELF_DEPLOY)
  │
  ▼
Verify (health monitor confirms fix)
  │
  ▼
Learn (update agent_decision_trees weight)
```

**Safety guardrails:**
- `autonomy_level` z `agent_catalog` — manual/semi/full
- `safety_level` check před každou operací
- Langfuse trace pro CELÝ loop (traceability)
- Rate limit: max 3 auto-PRs per hour
- Scope limit: Aisha NEMŮŽE modifikovat security policies nebo RLS bez expert approval

**Deliverables:**
- [x] `WF_SELF_LEARNING_LOOP` orchestrační workflow v n8n ✅ (partial — `Implement Change` node je placeholder/simulated, pipeline: Trigger → Evaluate → Risk Router → Create Branch → [stub] → Compliance Gate → Create PR)
- [x] `fn_create_improvement_proposal()` RPC funkce ✅ (SoT: `supabase/sql/functions/fn_create_improvement_proposal.sql`, s anomaly_key dedup)
- [x] `fn_evaluate_proposal_risk()` risk assessment ✅ (SoT: `supabase/sql/functions/fn_evaluate_proposal_risk.sql`)
- [ ] Rate limiter v n8n (max 3 PR/hour) — pouze dokumentovaný záměr, žádná implementace v workflow
- [~] Compliance gate integrace — zjednodušená (risk_level check), ne plný TypeScript+Lint+Tests pipeline
- [x] Langfuse full-loop trace ✅ (node `Log to Langfuse` připojen ze 3 bodů workflow)
- [ ] Demostrace: Aisha detekuje chybějící překlad → vytvoří PR → merge → deploy

---

## 🔗 Integrační architektura — Samoorganizující se celek

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AISHA ORCHESTRATOR (n8n)                         │
│  16 workflows · 7 community nodes · 35 MCP tools                  │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐          │
│  │ WF_DIRIGENT │  │ WF_KNOWLEDGE │  │ WF_STORY_SCAFFOLD│          │
│  │ (30 nodes)  │  │ (context AI) │  │ (delivery)       │          │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────────┘          │
│         │                │                  │                       │
│         ▼                ▼                  ▼                       │
│  ┌──────────────────────────────────────────────────────┐          │
│  │              MCP TOOL LAYER (35 tools)                │          │
│  │  knowledge_* · admin_* · story_* · compliance_*      │          │
│  │  nocodb_* · appsmith_* · monitoring_*                │          │
│  └──────────────────────────────────────────────────────┘          │
└───────────┬──────────────┬──────────────┬──────────────────────────┘
            │              │              │
            ▼              ▼              ▼
┌───────────────┐  ┌──────────────┐  ┌──────────────────┐
│   APPSMITH    │  │   NocoDB     │  │   SUPABASE       │
│   (Frontend)  │  │  (Analytics) │  │   (Source DB)    │
│               │  │              │  │                  │
│ StoryLoop     │  │ Data views   │  │ 278 tabulek      │
│ Dashboard     │  │ Analytics    │  │ RPC funkce       │
│ Financial     │  │ Aisha self-  │  │ RLS policies     │
│ Operations    │  │ management   │  │ Audit journal    │
│ Monitoring    │  │ board        │  │ agent_catalog    │
│               │  │ Agent        │  │ agent_configs    │
│  Appsmith API │  │ routing      │  │                  │
│  ↕ (Aisha)   │  │  NocoDB API  │  │  PostgREST API   │
└───────┬───────┘  │  ↕ (Aisha)  │  └────────┬─────────┘
        │          └──────┬───────┘           │
        └─────────────────┼───────────────────┘
                          │
                    ┌─────▼──────┐
                    │ PostgreSQL │  ← Shared database
                    │ (Supabase) │     (single source of truth)
                    └─────┬──────┘
                          │
        ┌─────────────────┼────────────────────┐
        │                 │                    │
   ┌────▼────┐    ┌──────▼──────┐     ┌──────▼──────┐
   │ Forgejo │    │  Langfuse   │     │  Verdaccio  │
   │ (Git)   │    │ (AI Obs.)   │     │ (npm reg.)  │
   │ git.    │    │ langfuse.   │     │ npm.        │
   │ id3a.cz │    │ id3a.cz     │     │ id3a.cz     │
   └─────────┘    └─────────────┘     └─────────────┘
```

### Datový tok

1. **Supabase** = Source of Truth — všechna data
2. **NocoDB** = Analytická vrstva nad stejnou DB — views, formule, reporting, **Aisha self-management board**
3. **Appsmith** = Dashboard vrstva — volá Supabase RPC + NocoDB API + n8n webhooky, **Aisha modifikuje přes API**
4. **Aisha (n8n)** = Orchestrátor — propojuje vše přes MCP tools a webhooky, **řídí NocoDB i Appsmith**

### NocoDB ↔ Appsmith bidirectional flow

```
NocoDB (Data)                    Appsmith (UI)
━━━━━━━━━━━                     ━━━━━━━━━━━━━
Analytické views  ──read──→    Dashboard zobrazení
Strukturální data ──read──→    Formuláře, tabulky
                  ←─trigger─   User actions → NocoDB API
                  ←─create──   Appsmith query → NocoDB view

Aisha řídí obě strany:
- NocoDB: AishaAdminBridge → nocodb_* operace
- Appsmith: AishaAdminBridge → appsmith_* operace
- Sync: Obě čtou ze sdílené PostgreSQL, NocoDB přes direct table access
```

---

## ✅ Deployment Checklist

### Pre-flight (před jakýmkoli deployem)

- [ ] `npm run test:run` — všechny testy projdou
- [ ] `npm run build` — build úspěšný
- [ ] `npm run test:gates` — gate testy projdou
- [ ] `npx tsc --noEmit` — žádné TypeScript chyby
- [ ] `npm run i18n:check` — překlady kompletní
- [ ] Supabase lokální DB running
- [ ] Docker Compose lokální stack running

### Fáze 0 Checklist — Appsmith Deploy

- [x] Appsmith Docker compose přidán do `docker-compose.local.yml` ✅
- [x] Appsmith Docker compose v separovaném `docker-compose.coolify-admin.yml` ✅
- [x] MongoDB sidecar nakonfigurován ✅
- [x] Appsmith na `localhost:8090` ✅
- [x] Admin účet vytvořen ✅
- [x] Supabase PostgreSQL datasource připojen (lokálně) ✅
- [ ] NocoDB API datasource připojen
- [ ] n8n Webhook datasource připojen
- [ ] Langfuse API datasource připojen
- [x] Workspace `AISHA` vytvořen ✅
- [ ] **Appsmith API token pro Aisha** vytvořen
- [x] Coolify deploy na `appsmith.aisha.guru` úspěšný ✅ (Admin stack running:healthy)
- [ ] Git sync nastaveno

### Fáze 1 Checklist — Forgejo + StoryLoop Design

- [x] Forgejo deployed na `repo.id3a.cz` ✅ (Forgejo produkčně funguje, aisha/evymo-ai-orchestrator existuje)
- [ ] Mirror z GitHub funkční (Forgejo je primary, ne mirror)
- [ ] StoryLoop dashboard wireframe v Appsmith
- [ ] NocoDB analytické views vytvořeny (10+ views)
- [x] AishaAdminBridge health check Appsmith ✅ (health_check operace v AishaAdminBridge včetně Appsmith service)

### Fáze 2 Checklist — StoryLoop + Aisha Autonomy

- [ ] StoryLoop Dashboard v Appsmith plně funkční
- [x] Security fixes deployed (TOCTOU) ✅ (commit `1c6c142` — `FOR UPDATE` lock)
- [x] Dead block actions opraveny ✅ (celý řetěz StoryDetail → StoryEntryBlockRenderer → Block → useStoryBlockActions → RPC napojen)
- [x] **AishaAdminBridge: NocoDB operace (8)** ✅ (již existovaly)
- [x] **AishaAdminBridge: Appsmith operace (5)** ✅ (Module 3 — `executeAppsmithOps()`)
- [x] **Monitoring admin panel** (On/Off toggle, interval config) ✅ (`useMonitoringConfig` + `AdminAiProactive`)
- [x] MCP tools pro NocoDB/Appsmith/Monitoring ✅ (`admin_nocodb_manage`, `admin_appsmith`, `admin_appsmith_manage`)
- [ ] `npm run test:run` — všechny testy stále projdou

---

## 📅 Časový odhad

| Fáze | Dny | Kumulativně | Závislosti |
|------|-----|-------------|------------|
| **0: Appsmith Deploy** | 1-2 | 1-2 | Žádné |
| **1: Forgejo + StoryLoop Design** | 2-3 | 3-5 | Fáze 0 |
| **2: StoryLoop + Aisha Autonomy** | 3-5 | 6-10 | Fáze 1 |
| **3: Financial & Operations** | 3-5 | 9-15 | Fáze 2 |
| **4: Knowledge Graph + Multi-Bot** | 2-3 | 11-18 | Paralelizovatelné s Fází 3 |
| **5: Story Delivery + Orchestrace** | 3-5 | 14-23 | Fáze 4 |
| **6: Accounts + Guild** | 3-5 | 17-28 | Fáze 5 |
| **7: Aisha Toolkit — Autonomní smyčka** | 5-8 | 22-36 | Fáze 4+ (může paralelně) |

**Celkem: ~22-36 session dní**

> **Poznámka k Fázi 7:** Moduly 1-3 jsou nezávislé na Fázi 5-6 a lze je implementovat paralelně.
> Module 1 (Rule Propagation) závisí pouze na existujícím expert_rules + story_rulesets (Fáze 5 deliverable, již hotovo).
> Module 2 (Forgejo) závisí na běžícím Forgejo (Fáze 1, není blokující — mock API pro testy).
> Module 4-5 závisí na Modulech 1-3.

---

## ⚠️ Rizika a mitigace

| Riziko | Impact | Mitigace |
|--------|--------|----------|
| Appsmith performance s Supabase | 🟡 Střední | Test s production data volume |
| Appsmith complexity pro Dirigenty | 🟡 Střední | Předdefinované dashboardy, read-only |
| NocoDB ↔ Appsmith latence | 🟡 Nízká | Obě čtou ze stejné PG |
| Dual mode confusion (React + Appsmith) | 🟡 Střední | Clear deprecation notices |
| Self-development scope creep | 🔴 Vysoký | Strict approval gates, expert review |
| MongoDB dependency (Appsmith) | 🟡 Střední | Malý footprint, backup strategy |
| 55 admin stránek migrace scope | 🔴 Vysoký | Postupná migrace, React jako fallback |
| Autonomní implementace referenčního projektu | 🔴 Vysoký | Jasně definované fáze, human-in-the-loop |

---

## 🔗 Související dokumenty

| Dokument | Status | Popis |
|----------|--------|-------|
| [AUTONOMY_PLAN.md](AUTONOMY_PLAN.md) | Superseded by MASTER_PLAN | Fáze A-E infra autonomie |
| [IMPLEMENTATION_PLAN.md](archive/IMPLEMENTATION_PLAN.md) | Superseded by MASTER_PLAN | Fáze 0-6 Aisha brain |
| [AISHA-Self-Managing-Organism.md](AISHA-Self-Managing-Organism.md) | Superseded by MASTER_PLAN | Epoch 0-4 evoluce |
| [AISHA_ADMIN_INTEGRATION.md](AISHA_ADMIN_INTEGRATION.md) | Active reference | NocoDB + Langfuse bridge |
| [N8N_AGENT_ARCHITECTURE.md](N8N_AGENT_ARCHITECTURE.md) | Active reference | n8n workflows a agenti |
| [analysis/STORYLOOP_MODULE_ANALYSIS.md](analysis/STORYLOOP_MODULE_ANALYSIS.md) | Active reference | StoryLoop code analysis |
| [SOURCE-TRUTH-ARCHITECTURE.md](SOURCE-TRUTH-ARCHITECTURE.md) | Active reference | Source of truth patterns |
| [LLM_ROUTER.md](LLM_ROUTER.md) | Active reference | Multi-provider AI abstrakce |

---

## Immediate Next Step

**Fáze 7 Moduly 1-3 HOTOVÉ** — Rule Propagation ✅, Forgejo Bridge ✅, Appsmith Connector ✅

**compose_context pipeline HOTOVÝ** — expert_rules seeded (10), story_rulesets (1), story_contexts (1), E2E verified ✅
**copilot-instructions.md GENEROVÁN** — 574 řádků, 10 pravidel ✅  
**Ecosystem audit** — 95% kompletní (104/110 komponent) ✅
**Aisha autonomy audit** — 6 kritických mezer identifikováno, 3 uzavřeny ✅

**Zbývající implementační priorita:**
1. ⏳ **Module 4: Proactive Activation** — workflows JSON existují, potřeba aktivovat v n8n (blokuje n8n 503)
2. ⏳ **Module 5: Self-Learning Loop** — WF existuje (partial: `Implement Change` je stub), rate limiter chybí
3. 🟡 **Fáze 0 zbytky** — produkční datasources (NocoDB, n8n, Langfuse), Git sync, API token pro Aisha
4. 🟡 **Fáze 1 zbytky** — StoryLoop wireframe v Appsmith, NocoDB views
5. 🔴 **Blockers** — web 503 (Coolify deploy cycling), n8n 503, OpenAI 429 (embeddings)

> **Exekuce:** priority 1–5 jsou rozpadnuté do work-packages **WP-00…WP-07** v [planning/DELEGATION_PLAN.md](planning/DELEGATION_PLAN.md) (§5 backlog) se zadáními v `docs/planning/zadani/` — připraveno pro delegaci na nižší modely (Sonnet 5 / Opus 4.8) dle tiered policy.
