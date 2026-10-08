# AUTONOMY_PLAN.md — Plán plné infrastrukturní autonomie

> **Verze:** 1.0 | **Datum:** 2025-07  
> **Status:** DRAFT — čeká na review
>
> **Historický dokument.** Popisuje infrastrukturu jedné instance z roku 2025. CI dnes
> běží na GitHub Actions (`.github/workflows/`, hostované runnery, nasazení opt-in) —
> aktuální stav je v [deploy/CICD.md](deploy/CICD.md).

---

## TL;DR

AISHA platforma přechází na **plně autonomní infrastrukturu** s vlastním NPM registrem (Verdaccio), Git serverem (git server), a low-code admin nástroji (NocoDB + Appsmith). Cílem je **eliminace závislosti na externích službách** (npmjs.org, GitHub) pro kritické operace a **progresivní nahrazení 32 z 52 custom React admin stránek** low-code řešeními.

---

## 📊 Aktuální stav infrastruktury

### ✅ Nasazeno a funkční

| Služba | Stav | URL / Port | Compose |
|--------|------|------------|---------|
| **NocoDB** | ✅ Produkce + Local | `nocodb.aisha.guru` / `localhost:8080` | coolify + local |
| **Langfuse** | ✅ Produkce + Local | `langfuse.aisha.guru` / `localhost:3100` | coolify + local |
| **n8n** | ✅ Produkce + Local | `n8n.aisha.guru` / `localhost:5678` | coolify + local |
| **Supabase** | ✅ Produkce + Local | `api.aisha.guru` / `localhost:57421` | coolify + local |

### ⚠️ Nasazeno na Coolify, nepropojeno s projektem

| Služba | Stav | Coolify App | Co chybí |
|--------|------|-------------|----------|
| **Verdaccio** | ⚠️ Deploy ready | `apps/verdaccio/` | `.npmrc` v projektu, publish workflow |

### ✅ Nasazeno, pipeline funkční

| Služba | Stav | URL | Compose / Config |
|--------|------|-----|------------------|
| **git server** | ✅ Produkce | `git.example.com` | `coolify/apps/git-server/` |
| **CI runner** | ✅ Produkce | (součást git server stacku) | DinD, `runner:6.2.2` |
| **CI (Actions)** | ✅ Funkční | — | `.github/workflows/ci.yml` |

### ❌ Neexistuje

| Služba | Stav | Co je třeba |
|--------|------|-------------|
| **Appsmith** | ❌ Nic | Docker compose, Coolify deploy, připojení k DB |

---

## 🎯 Fáze implementace

### Fáze A: Verdaccio — Vlastní NPM registr (1–2 dny)

**Cíl:** Všechny interní npm balíčky se publikují do soukromého registru. n8n instaluje community nody z Verdaccio.

#### A1. Nastavení Verdaccio na Coolify

Verdaccio je připraveno v `~/projects/coolify/apps/verdaccio/` (image `verdaccio/verdaccio:6.2.4`, port 4873). Potřeba:

- [ ] Deploy na Coolify s doménou (např. `npm.id3a.cz`)
- [ ] Nastavit HTTPS přes Coolify/Traefik
- [ ] Vytvořit autentizační token: `npm adduser --registry https://npm.id3a.cz`
- [ ] Nastavit uplink na npmjs.org pro proxy veřejných balíčků

**Verdaccio config (`conf/config.yaml`):**
```yaml
storage: /verdaccio/storage/data
auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
    max_users: 10
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  'n8n-nodes-aisha':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
  '@evymo/*':
    access: $authenticated
    publish: $authenticated
    unpublish: $authenticated
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs
listen:
  - 0.0.0.0:4873
```

#### A2. Napojení projektu na Verdaccio

- [ ] Vytvořit `.npmrc` v root projektu:
  ```
  @evymo:registry=https://npm.id3a.cz/
  //npm.id3a.cz/:_authToken=${VERDACCIO_TOKEN}
  ```
- [ ] Aktualizovat `extensions/aisha-dirigent/.npmrc` (aktuálně `registry.npmjs.org`)
- [ ] Aktualizovat `packages/n8n-nodes-aisha/package.json`:
  ```json
  {
    "name": "@evymo/n8n-nodes-aisha",
    "publishConfig": {
      "registry": "https://npm.id3a.cz/",
      "access": "restricted"
    }
  }
  ```

#### A3. Deploy skripty — přepojení na Verdaccio

- [ ] `packages/n8n-nodes-aisha/scripts/deploy-to-n8n.mjs`:
  - Řádek 251: `npm publish --access public` → `npm publish --registry https://npm.id3a.cz/`
  - Řádky 263-264: „npm registry propagation" → okamžitě (Verdaccio je lokální)
- [ ] Přidat `VERDACCIO_TOKEN` do `.env.aisha`

#### A4. n8n — instalace custom nodů z Verdaccio

- [ ] Nastavit `N8N_COMMUNITY_PACKAGES_REGISTRY` v n8n env:
  ```yaml
  # v docker-compose.coolify.yml i docker-compose.local.yml
  N8N_COMMUNITY_PACKAGES_REGISTRY: https://npm.id3a.cz/
  ```
- [ ] Ověřit, že n8n úspěšně nainstaluje `@evymo/n8n-nodes-aisha` z Verdaccio

#### A5. Budoucí balíčky pro Verdaccio

| Balíček | Současný stav | Akce |
|---------|--------------|------|
| `n8n-nodes-aisha` | npm public | → `@evymo/n8n-nodes-aisha` na Verdaccio |
| `design-tokens` | lokální build | → `@evymo/design-tokens` na Verdaccio |
| `aisha-dirigent` (VS Code ext) | extension, ne npm | Ponechat jako .vsix, ale deps z Verdaccio |
| Budoucí shared libs | – | `@evymo/shared-*` na Verdaccio |

---

### Fáze B: git server — Vlastní Git server (2–3 dny)

**Cíl:** Sekundární Git mirror pro nezávislost na GitHub. Coolify deploy z git server. CI/CD pipeline.

#### B1. Deploy git server na Coolify ✅ HOTOVO

git server je nasazeno na `git.example.com` (git server 13.0.3 + PostgreSQL 16):

- [x] Deploy na Coolify s doménou `git.example.com`
- [x] Admin účet vytvořen
- [x] Organizace `evymo` vytvořena
- [x] Runner nasazený (DinD izolace, `self-hosted act runner:6.2.2`)
- [x] Runner labels: `ubuntu-latest:docker://node:20-bookworm`, `self-hosted:host`
- [ ] Nastavit SMTP pro notifikace (viz git server README — SMTP env vars)

#### B2. Mirror z GitHub → git server ⚠️ ROZPRACOVÁNO

**Strategie: GitHub zůstává sekundární, git server je primární pro deploy + CI/CD.**

- [x] git server repozitář `<org>/aisha-dirigent` existuje
- [ ] Nastavit automatický mirror (push hook na obě remotes):
  ```bash
  git remote set-url --add --push origin git@git.example.com:<org>/aisha-dirigent.git
  git remote set-url --add --push origin git@github.com:evymo/aisha-dirigent.git
  ```

#### B3. Coolify deploy z git server ✅ HOTOVO

- [x] git server je source v Coolify pro web deploy
- [x] Coolify webhook pro auto-deploy (z `.github/workflows/ci.yml`)
- [x] Web deploy přes `docker-compose.coolify-prebuilt.yml` (~2KB, žádný ARG_MAX)
- [x] Migrate + web services v compose

#### B4. CI (Actions) (CI) ✅ HOTOVO

- [x] CI runner nasazený (DinD, součást git server stacku)
- [x] `.github/workflows/ci.yml` — plná CI/CD pipeline
- [x] Smart change detection (skip docs-only, detekce migration/code/functions změn)
- [x] Pipeline: detect → check → test → build → deploy (webhook)
- [x] Node 22, npm přes Verdaccio (`npm.id3a.cz`)
- [x] Self-hosted action mirrors na `git.example.com`

#### B5. Budoucí git server repozitáře

| Repo | Účel |
|------|------|
| `evymo/aisha-dirigent` | Hlavní aplikace (mirror) |
| `evymo/coolify-apps` | Coolify deploy catalog |
| `evymo/n8n-workflows` | Export n8n workflows |
| `evymo/knowledge-base` | Offline knowledge extraction |
| `evymo/appsmith-configs` | Appsmith export/backup |

---

### Fáze C: NocoDB — Rozšíření admin bridge (3–5 dní)

**Cíl:** NocoDB přebírá CRUD/data management stránky. Admin UI se ztenčuje.

#### C0. Aktuální stav NocoDB

NocoDB je **již nasazeno** a propojeno:
- Produkce: `nocodb.aisha.guru` (v `docker-compose.coolify.yml`)
- Lokálně: `localhost:8080` (v `docker-compose.local.yml`)
- Připojeno k Supabase PG přes `supabase_admin`
- 6 MCP admin tools implementováno (dle `AISHA_ADMIN_INTEGRATION.md`)
- `AishaAdminBridge` n8n node: 8 NocoDB ops + 6 Langfuse ops

#### C1. NocoDB views pro CRUD admin stránky

Tyto stránky jsou **čisté CRUD** — NocoDB je nahradí spreadsheet/form views:

| Admin stránka | Supabase tabulka | NocoDB akce |
|---------------|-----------------|-------------|
| `AdminBiomarkerRanges` | `biomarker_ranges` | Grid view + form |
| `AdminConsultants` | RPC `get_consultants_*` | Grid view (read-only) |
| `AdminProducts` | `products` | Grid view + form |
| `AdminSupplementCatalog` | `supplements` | Grid view + form + gallery |
| `AdminSymptomCatalog` | `symptom_catalog` | Grid view + search |
| `AdminStudies` | `programs` | Grid view + kanban |
| `AdminStudyConsents` | `study_consents` | Grid view + form |
| `AdminQuestionnaires` | questionnaire tables | Grid + form builder |
| `AdminTestQuestions` | `test_questions` | Grid view + form |

**~9 stránek** → NocoDB views

#### C2. NocoDB views pro content management

| Admin stránka | Supabase tabulka | NocoDB akce |
|---------------|-----------------|-------------|
| `AdminArchive` | `archive` | Grid + gallery view |
| `AdminFeaturedProducts` | `featured_products` | Grid view |
| `AdminHeroSlides` | `hero` | Gallery view |
| `AdminKnowledgeTopics` | `knowledge_topics` | Grid + kanban |
| `AdminNewsArticles` | `news_articles` | Grid + form + calendar |

**~5 stránek** → NocoDB views

#### C3. NocoDB views pro operational stránky (částečně)

| Admin stránka | NocoDB akce | Poznámka |
|---------------|-------------|----------|
| `AdminDeletionRequests` | Grid + kanban | Jednoduché approval flow |
| `AdminNotifications` | Grid view | Read-only přehled |
| `AdminShipments` | Grid + kanban | Status tracking |

**~3 stránky** → NocoDB views (jednodušší operational)

**Celkem NocoDB: ~17 stránek**

#### C4. Implementační kroky

- [ ] Vytvořit NocoDB projekt `AISHA Admin` s připojením na Supabase PG
- [ ] Pro každou tabulku vytvořit:
  - Grid view (přehled)
  - Form view (vytváření/editace)
  - Gallery view (kde má smysl — produkty, hero slides)
  - Kanban view (kde jsou statusy — studies, shipments)
- [ ] Nastavit role a permissions v NocoDB
- [ ] Vytvořit shared views pro read-only přístupy
- [ ] Otestovat CRUD operace přes NocoDB UI

---

### Fáze D: Appsmith — Low-code admin dashboardy (5–7 dní)

**Cíl:** Appsmith přebírá komplexní admin stránky vyžadující business logiku, grafy, a multi-step workflow.

#### D0. Proč Appsmith?

NocoDB je výborný pro **jednoduché CRUD** (spreadsheet view), ale nedostačuje pro:
- Komplexní dashboardy s grafy a metrikami
- Multi-step formuláře s validací
- Workflow s approval gates
- Vlastní business logika (výpočty, agregace)

Appsmith je **open-source low-code platform** s:
- Drag & drop UI builder
- Direct DB queries (PostgreSQL, REST API)
- JavaScript pro business logiku
- Role-based access control
- Git sync pro version control

#### D1. Deploy Appsmith na Coolify

**Appsmith aktuálně NEEXISTUJE v infrastruktuře — je třeba přidat od nuly.**

- [ ] Vytvořit `apps/appsmith/docker-compose.yml` v Coolify catalog:
  ```yaml
  services:
    appsmith:
      image: appsmith/appsmith-ee:latest
      # nebo community: appsmith/appsmith-ce:latest
      ports:
        - "8090:80"
      volumes:
        - appsmith-data:/appsmith-stacks
      environment:
        APPSMITH_MONGODB_URI: "mongodb://appsmith-mongo:27017/appsmith"
        APPSMITH_ENCRYPTION_PASSWORD: "${APPSMITH_ENCRYPTION_PASSWORD}"
        APPSMITH_ENCRYPTION_SALT: "${APPSMITH_ENCRYPTION_SALT}"
      depends_on:
        - appsmith-mongo
      restart: unless-stopped
    
    appsmith-mongo:
      image: mongo:6
      volumes:
        - appsmith-mongo-data:/data/db
      restart: unless-stopped

  volumes:
    appsmith-data:
    appsmith-mongo-data:
  ```

- [ ] Deploy na Coolify s doménou `appsmith.aisha.guru`
- [ ] Přidat do `docker-compose.local.yml` (profil `admin`):
  ```yaml
  appsmith:
    image: appsmith/appsmith-ce:latest
    ports:
      - "8090:80"
    volumes:
      - appsmith-data:/appsmith-stacks
    profiles: ["full", "admin"]
  ```

#### D2. Připojení k datovým zdrojům

- [ ] Supabase PostgreSQL (přímé DB připojení)
- [ ] Supabase REST API (pro RPC funkce)
- [ ] NocoDB REST API (pro cross-referencing)
- [ ] Langfuse REST API (pro AI traces)

#### D3. Appsmith dashboardy — Financial/Payments

Tyto stránky vyžadují **grafy, výpočty, multi-step workflow**:

| Admin stránka | Appsmith dashboard | Komponenty |
|---------------|-------------------|------------|
| `AdminBankReconciliation` | Bank Reconciliation | Tabulka + párování + grafy |
| `AdminContributions` | Contributions Dashboard | Tabulka + sumarizace + export |
| `AdminMemberSubscriptions` | Subscription Manager | Tabulka + status kanban + revenue graf |
| `AdminOrders` | Order Management | Tabulka + detail modal + status flow |
| `AdminPayments` | Payment Dashboard | Tabulka + grafy + filtry |
| `AdminSubscriptionPackages` | Package Editor | Form builder + preview + pricing |
| `AdminTokenomics` | Token Economy | Grafy + simulace + parametry |

**~7 stránek** → Appsmith

#### D4. Appsmith dashboardy — Complex Operational

| Admin stránka | Appsmith dashboard | Komponenty |
|---------------|-------------------|------------|
| `AdminDistribution*` (3) | Distribution Workflow | Multi-step wizard + print |
| `AdminDosage*` (2) | Dosage Calculator | Formulář + výpočet + validace |
| `AdminEnrollment*` (2) | Enrollment Pipeline | Kanban + form + approval |
| `AdminExpeditionCalendar` | Expedition Planner | Kalendář + drag & drop |
| `AdminProduction` | Production Board | Kanban + timeline + metrics |
| `AdminRegistration*` (2) | Registration Flow | Multi-step form + validace |

**~8 stránek** (15 route entries, ale sdružitelné) → Appsmith

#### D5. Git Sync s git server

- [ ] Nastavit Appsmith Git sync na git server repo `<org>/appsmith-configs`
- [ ] Automatické version control UI konfigurací
- [ ] Branch-based deployment (dev → staging → prod)

---

### Fáze E: React Admin — Co zůstává (průběžně)

**Tyto stránky ZŮSTÁVAJÍ v React** — jsou příliš specializované nebo tight-coupled:

#### AI/Platform Monitoring (10 stránek) — ZŮSTÁVÁ

| Stránka | Důvod |
|---------|-------|
| `AdminAiObservability` | Realtime streaming, WebSocket, custom vizualizace |
| `AdminAiRunDetail` | Komplexní trace viewer, timeline, nested JSON |
| `AdminAiRuns` | Tabulka s real-time updates + filtrování |
| `AdminAuditJournal` | Security-sensitive, audit trail viewer |
| `AdminKnowledgeModeration` | AI-powered approval workflow |
| `AdminModerationSessions` | Epocha 1 — tight-coupled s MCP pipeline |
| `AdminSessionMonitoring` | Real-time session monitoring |
| `AdminOutcomes` | Custom vizualizace outcomes |
| `AdminOverview` | Dashboard s custom widgety |
| `AdminStoryLoop` | Story delivery state machine UI |

#### Configuration/Settings (8 stránek) — ZŮSTÁVÁ

| Stránka | Důvod |
|---------|-------|
| `AdminAgentCatalog` | Agent config editor, JSON schema |
| `AdminAgentConfigurations` | Specializovaný editor |
| `AdminContextProfiles` | Token budget editor |
| `AdminMcpTokens` | Security-sensitive token management |
| `AdminPermissions` | RBAC editor, tree structure |
| `AdminRoles` | Role hierarchy editor |
| `AdminSettings` | Platform settings, nested config |
| `AdminTranslations` | i18n editor s diff view |

**Celkem v React: ~20 stránek (z 52)**

---

## 📊 Souhrnný migrační plán

```
                    52 unique admin stránek
                    ━━━━━━━━━━━━━━━━━━━━━━
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    NocoDB (~17)      Appsmith (~15)    React (~20)
    ─────────────     ──────────────    ───────────
    CRUD/Data (9)     Financial (7)    AI/Monitoring (10)
    Content (5)       Operations (8)   Config/Settings (8)
    Simple Ops (3)                     + Members/Partners
                                         (security)
```

### Prioritní pořadí migrace

| Priorita | Fáze | Stránky | Effort | Impact |
|----------|------|---------|--------|--------|
| 🔴 P0 | A (Verdaccio) | 0 stránek | 1–2 dny | Infrastrukturní základ |
| 🔴 P0 | C1 (NocoDB CRUD) | 9 stránek | 3 dny | Okamžitý win — CRUD eliminace |
| 🟠 P1 | C2 (NocoDB Content) | 5 stránek | 2 dny | Content management |
| 🟠 P1 | D1 (Appsmith deploy) | 0 stránek | 1 den | Infrastrukturní základ |
| 🟡 P2 | D3 (Appsmith Finance) | 7 stránek | 4 dny | Komplexní dashboardy |
| ✅ DONE | B (git server) | 0 stránek | — | Git + CI/CD + deploy hotovo |
| 🟢 P3 | D4 (Appsmith Ops) | 8 stránek | 5 dní | Operační workflow |
| 🟢 P3 | C3 (NocoDB Ops) | 3 stránky | 1 den | Jednoduché operational |

**Celkový estimated effort: ~20–25 dní**

---

## 🔗 Propojení s AISHA orchestrací

### NocoDB ↔ AISHA (již existuje)

Dle `AISHA_ADMIN_INTEGRATION.md`:
- 6 MCP admin tools pro NocoDB/Langfuse queries
- `AishaAdminBridge` n8n node (8 NocoDB + 6 Langfuse ops)
- 5 n8n workflows (health monitor, orchestration, notifications, approval gate, performance review)
- DB: `integration_services` + `integration_service_logs`

### Appsmith ↔ AISHA (nové)

- [ ] Přidat Appsmith do `integration_services` tabulky
- [ ] Nový MCP tool: `admin_appsmith_query` — volání Appsmith API
- [ ] Rozšířit `AishaAdminBridge` o Appsmith operace
- [ ] n8n workflow pro Appsmith health monitoring

### git server ↔ AISHA (nové)

- [ ] Přidat git server do `integration_services` tabulky  
- [ ] Nový MCP tool: `admin_github_repos` — list/create repos
- [ ] n8n workflow pro auto-mirror z GitHub
- [ ] git server webhooks → n8n pro CI/CD pipeline

### Verdaccio ↔ AISHA (nové)

- [ ] Přidat Verdaccio do `integration_services` tabulky
- [ ] n8n workflow: auto-publish po úspěšném buildu
- [ ] MCP tool: `admin_npm_packages` — list published packages

---

## 🛡️ Bezpečnostní úvahy

### Verdaccio
- HTTPS only (přes Traefik)
- Autentizace povinná pro publish
- Read access pro `@evymo/*` pouze pro authenticated
- Proxy na npmjs.org pro veřejné balíčky

### git server
- HTTPS only, SSH volitelně
- 2FA pro admin účty
- Webhook secret pro Coolify deploy
- Omezení registrace (invite-only)

### Appsmith
- Připojení k DB přes internal Docker network (ne veřejný endpoint)
- RBAC: Admin → full, Staff → dashboards, Read-only → reports
- Audit log pro změny v dashboardech
- Git sync = version history pro rollback

### NocoDB
- Již za auth (token-based)
- RLS na Supabase PG úrovni (NocoDB respektuje PG permissions `supabase_admin` role)
- Shared views s expirací pro external stakeholders

---

## 📋 Checklist — Celková připravenost

### Infrastruktura
- [ ] Verdaccio na Coolify s doménou + HTTPS
- [ ] git server na Coolify s doménou + HTTPS
- [ ] Appsmith na Coolify s doménou + HTTPS
- [ ] Appsmith v `docker-compose.local.yml`
- [ ] Všechny služby v `integration_services` tabulce

### NPM Pipeline
- [ ] `.npmrc` v root projektu → Verdaccio
- [ ] `n8n-nodes-aisha` přejmenovaný na `@evymo/n8n-nodes-aisha`
- [ ] n8n env `N8N_COMMUNITY_PACKAGES_REGISTRY` → Verdaccio
- [ ] `deploy-to-n8n.mjs` přepojený na Verdaccio
- [ ] `design-tokens` publikovatelný na Verdaccio

### Git Pipeline
- [x] GitHub → git server mirror funkční (manuální push, auto-mirror TBD)
- [x] Coolify deploy z git server webhookem
- [x] CI (Actions) runner nasazený (DinD, součást git server stacku)
- [x] CI/CD pipeline: detect → check → test → build → deploy webhook
- [ ] Automatický mirror (git push hook na obě remotes)

### Admin Migration
- [ ] NocoDB projekt `AISHA Admin` s views
- [ ] Appsmith workspace `AISHA` s datasources
- [ ] 17 NocoDB views nahrazujících React stránky
- [ ] 15 Appsmith dashboardů nahrazujících React stránky
- [ ] React admin routes s deprecated redirecty

### AISHA Integration
- [ ] MCP tools pro Appsmith, git server, Verdaccio
- [ ] n8n workflows pro health monitoring všech služeb
- [ ] `AishaAdminBridge` rozšířený o Appsmith + git server ops

---

## 🔄 Migrační strategie pro admin stránky

### Krok 1: Dual mode (přechodné období)

```
React Admin (stávající)     NocoDB / Appsmith (nové)
━━━━━━━━━━━━━━━━━━━━━━     ━━━━━━━━━━━━━━━━━━━━━━━
AdminProducts (React)   ←→  NocoDB Products Grid view
AdminPayments (React)   ←→  Appsmith Payments Dashboard
```

Obě rozhraní pracují se stejnou DB → žádná migrace dat.

### Krok 2: Redirect z React admin

```typescript
// V React admin route — deprecation notice
const AdminProducts = () => {
  return (
    <DeprecatedAdminPage 
      newUrl="https://nocodb.aisha.guru/dashboard/#/nc/view/..."
      pageName="Products"
    />
  );
};
```

### Krok 3: Odstranění React kódu

Po ověření, že NocoDB/Appsmith plně nahrazuje funkčnost:
- Odstranit React komponentu
- Odstranit route z routeru
- Odstranit související hook (pokud není sdílený)
- Odstranit i18n klíče
- Aktualizovat testy

---

## 📝 Poznámky pro implementaci

### Verdaccio — Okamžitě realizovatelné
Verdaccio je nejjednodušší krok. Docker compose je ready, stačí deploy + config. Umožní okamžitě:
- Private publishing pro `n8n-nodes-aisha`
- Budoucí shared knihovny pod `@evymo/` scope
- Nezávislost na npmjs.org pro interní balíčky

### git server — Strategická záloha
git server je primárně **mirror a záloha**. GitHub zůstává hlavní (community, PRs, issues). git server přidává:
- Self-hosted zálohu kódu
- Coolify deploy source (eliminace SPOF na GitHub)
- CI (Actions) pro self-hosted CI

### NocoDB — Quick wins
NocoDB je **již nasazeno** a propojeno s Supabase. Stačí vytvořit views. Největší ROI s nejmenším úsilím.

### Appsmith — Největší effort, největší impact
Appsmith vyžaduje nový deploy + dashboard design, ale přináší:
- Professional admin dashboardy bez React kódu
- Drag & drop úpravy pro non-developers (Dirigenti)
- Git-synced konfiguraci
- Eliminaci ~15 komplexních React stránek

---

## 🔗 Související dokumenty

| Dokument | Relevance |
|----------|-----------|
| [AISHA_ORCHESTRATION_PLAN.md](AISHA_ORCHESTRATION_PLAN.md) | Fáze 0-4 orchestrace |
| [AISHA_ADMIN_INTEGRATION.md](AISHA_ADMIN_INTEGRATION.md) | NocoDB + Langfuse bridge |
| [N8N_AGENT_ARCHITECTURE.md](N8N_AGENT_ARCHITECTURE.md) | n8n workflows a agenti |
| [deploy/COOLIFY.md](deploy/COOLIFY.md) | Coolify deployment guide |
| [SOURCE-TRUTH-ARCHITECTURE.md](SOURCE-TRUTH-ARCHITECTURE.md) | Source of truth patterns |
