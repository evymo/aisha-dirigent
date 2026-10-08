---
name: aisha-appsmith-connector
description: Operate Appsmith dashboards in the AISHA platform via REST API + Git sync — read dashboard/page/query state, propose and apply layout changes, deploy dashboards, provision datasources. Covers the implemented Fáze 7 Modul 3 appsmith connector (5 API operací v AishaAdminBridge + MCP tools admin_appsmith/admin_appsmith_manage) and the Fáze 0/1 dashboard layer (StoryLoop dashboard, AISHA Ops, template builder). Triggers on "appsmith", "dashboard deploy", "appsmith api", "git sync", "storyloop dashboard", "appsmith datasource", "appsmith connector", "update_page", "deploy_app", "WF_APPSMITH_DASHBOARD_BUILDER".
---

# AISHA Appsmith Connector Skill

V tomto repu je **Appsmith = frontend dashboard vrstva** celé platformy (`appsmith.aisha.guru` v prod, `localhost:8090` lokálně). Zde žije StoryLoop admin dashboard, AISHA Ops observability dashboard a postupně migruje 15+ operačních/finančních stránek. Appsmith je zároveň **canvas pro Aishine autonomní UI modifikace** — Aisha přes REST API čte stav stránek, navrhuje změny layoutu, deployuje a synchronizuje do Gitu.

Connector (Fáze 7 Modul 3) je **hotový**: 5 API operací v `executeAppsmithOps()` v AishaAdminBridge n8n nodu + MCP tools `admin_appsmith` (full, `admin.write`) a `admin_appsmith_manage` (safe subset, `admin.read`). Dashboardová vrstva Fáze 0/1 je částečně hotová — deploy funguje, StoryLoop wireframe a Git sync na git server zatím ne (viz Pitfalls).

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Čtení stavu Appsmith aplikace/stránek/queries přes API | **Ano** |
| Změna page layoutu (DSL) + deploy dashboardu | **Ano** |
| Git sync Appsmith aplikace na branch | **Ano** |
| Nový dashboard/page template v `appsmith/` + render přes builder | **Ano** |
| Provisioning Appsmith datasource (PostgreSQL/PostgREST) | **Ano** |
| Rozšíření `executeAppsmithOps()` o novou operaci | **Ano** |
| NocoDB views / analytický backend | **Ne** — viz `aisha-nocodb-view` skill |
| Orchestrace přes n8n workflow (WF_*, aishaRpc, approval gate) | **Ne** — viz `aisha-n8n-workflow` skill |
| Autonomous deploy flow Phase 4 (drift → B/G → rollback → dashboard regen) | **Ne** — viz `aisha-deploy-flow` skill |
| Nový Fastify route / RPC funkce | **Ne** — viz `aisha-edge-fn` / `aisha-rpc` skills |

## Architektura: kde co žije

```
packages/n8n-nodes-aisha/
├── nodes/AishaAdminBridge/AishaAdminBridge.node.ts   # executeAppsmithOps() — 5 operací
└── credentials/AishaAppsmithApi.credentials.ts        # baseUrl + apiKey (n8n credential)

trash/legacy-archive/edge-functions-reference/mcp-knowledge-server/index.ts
                                                       # MCP tools admin_appsmith + admin_appsmith_manage
                                                       # (kontraktní SoT — parsuje ho mcp-tool-contract.test.ts)
appsmith/
├── dashboards/*.template.json   # celé aplikace (aisha-ops, audience)
├── pages/*.template.json        # stránky uvnitř AISHA Ops app (playwright-qa, spend-governance, …)
├── templates/story-intra.template.json   # Story Intra — user-facing intranet
└── widgets/*.json + README.md   # widget katalog (Mustache placeholdery)

appsmith-templates/audience/     # audience dashboardy (contact-directory, tier-funnel, …) + DEPLOY.md

scripts/build-aisha-appsmith.mjs      # generalized builder: render + hash + skip-if-unchanged
scripts/appsmith-provision.sh          # datasource provisioning (npm run appsmith:provision)
scripts/provision-appsmith.sh          # StoryLoop app provisioning (local/prod, --check)
scripts/appsmith-api-setup.py          # idempotentní lokální setup (workspace, datasource, app)

n8n/workflows/WF_APPSMITH_DASHBOARD_BUILDER.json   # cron 30 min + webhook → builder → aishaRpc log
docker-compose.coolify-admin.yml       # prod deploy: appsmith-auth (OAuth2 Proxy) → appsmith-gateway (Caddy) → Appsmith CE
```

## 5 API operací (Modul 3 — implementováno)

Zdroj pravdy je `executeAppsmithOps()` v `packages/n8n-nodes-aisha/nodes/AishaAdminBridge/AishaAdminBridge.node.ts`:

| Operace | Skutečný Appsmith endpoint | Node parametry | MCP tool arg |
|---|---|---|---|
| `list_pages` | `GET /api/v1/pages?applicationId=…` | `applicationId` | `application_id` |
| `get_page` | `GET /api/v1/pages/{pageId}` | `pageId` | `page_id` |
| `update_page` | `PUT /api/v1/layouts/{pageId}` | `pageId`, `pageLayout` (JSON string DSL) | `page_id`, `page_layout` |
| `deploy_app` | `POST /api/v1/applications/deploy/{applicationId}` | `applicationId` | `application_id` |
| `git_sync` | `POST /api/v1/git/push/{applicationId}` (body `{branchName}`) | `applicationId`, `appsmithBranch` | `application_id`, `branch` |

Auth: `Authorization: Bearer {apiKey}` — v n8n z credentialu `aishaAppsmithApi` (`AishaAppsmithApi.credentials.ts`), v MCP tools z `integration_services` (`service_name='appsmith'`, `base_url`, `config.api_key`).

MCP vrstva má dvě úrovně (viz `docs/MCP_SCOPE_REFERENCE.md`):
- **`admin_appsmith`** — všech 5 operací, scope `admin.write`
- **`admin_appsmith_manage`** — whitelisted subset bez `update_page` (`list_pages`, `get_page`, `deploy_app`, `git_sync`), scope `admin.read`, loguje do integration audit trailu

## Kanonický workflow: read → propose → apply → deploy

Vždy v tomto pořadí — nikdy slepý write:

1. **Read** — `list_pages` (zjisti page IDs) → `get_page` (stáhni aktuální DSL layoutu)
2. **Propose** — uprav DSL lokálně; u autonomních změn zapiš návrh do trace/proposal, ne rovnou do Appsmith
3. **Apply** — `update_page` s celým novým layoutem (JSON string; operace je replace, ne patch)
4. **Deploy** — `deploy_app` (bez toho zůstane změna jen v edit módu)
5. **Git sync** — `git_sync` na branch pro backup/review (cílový repo deklaruje operátor na svém git hostingu — propojení je zatím nedokončený deliverable Fáze 1.1 v `docs/MASTER_PLAN.md`)

V n8n: node **AishaAdminBridge** se `service: appsmith` + credential `AISHA Appsmith API`. Pro orchestraci celého flow (schedule, approval gate, audit) viz `aisha-n8n-workflow` skill.

## Template pipeline (dashboardová vrstva Fáze 0/1)

Dashboardy se NEklikají ručně — žijí jako šablony v repu a renderuje je builder:

```bash
node scripts/build-aisha-appsmith.mjs                     # render všech artefaktů
node scripts/build-aisha-appsmith.mjs --slug playwright-qa # jeden artefakt
node scripts/build-aisha-appsmith.mjs --dry-run            # render bez zápisu hashe
node scripts/build-aisha-appsmith.mjs --force              # bypass hash check
```

Sekvence builderu: template → widget katalog (`appsmith/widgets/`, Mustache placeholdery dle `appsmith/widgets/README.md`) → source discovery (n8n/RPC/Coolify) → render → SHA-256 content hash → porovnání přes RPC `get_last_dashboard_hash` / zápis `store_dashboard_hash` → výstup `dist/appsmith/<slug>.json`.

- **Widget ID konvence:** deterministické `widget-{section}-{kind}-{source-slug}` → stejný zdroj = stejné ID = idempotentní re-import.
- **Builder je render-only** — skutečný import do Appsmith API je follow-up (viz hlavička `scripts/build-aisha-appsmith.mjs` + `docs/release/AISHA_APPSMITH_DEPLOY.md`). Import dnes = ruční přes Appsmith UI nebo provisioning skripty.
- Automatický re-render běží přes `n8n/workflows/WF_APPSMITH_DASHBOARD_BUILDER.json` (scheduleTrigger 30 min + manual webhook → executeCommand → aishaRpc log).
- Prod topologie: požadavky jdou přes OAuth2 Proxy (Keycloak) → Caddy gateway → Appsmith CE (`docker-compose.coolify-admin.yml`); skip-auth je jen pro `/api/v1/users/super` a `/api/v1/health` (viz `scripts/provision-appsmith.sh`).

## Common pitfalls (NEDĚLAT / pozor)

❌ **`update_page` ≠ `PUT /pages/{id}`** — implementace volá `PUT /api/v1/layouts/{pageId}`. Tabulka v `docs/MASTER_PLAN.md` §7.3 uvádí `/pages/{id}` — kód je zdroj pravdy.
❌ `update_page` s partial layoutem — je to full replace; vždy nejdřív `get_page`, modifikuj, pošli celé DSL.
❌ Zapomenutý `deploy_app` po `update_page` — změna zůstane nepublikovaná.
❌ MCP tool bez registrace služby — `admin_appsmith*` hledá `integration_services` řádek `service_name='appsmith'` s `base_url` + `config.api_key`; bez něj vrací toolError.
❌ Hardcoded secrets nebo emoji v `appsmith/**/*.json` — blokuje `appsmith-dashboard.gate`.
❌ Nový template mimo builder — každý `appsmith/{dashboards,pages}/*.template.json` musí být dosažitelný builderem, jinak failne `aisha-appsmith-importer.gate` (dead-JSON shape z PR #69/#91).
❌ Action button widget bez `role_required` — gate to kontroluje (`appsmith/widgets/button.json`).
❌ Admin credentials v kódu — `scripts/appsmith-api-setup.py` čte `APPSMITH_ADMIN_EMAIL`/`APPSMITH_ADMIN_PASSWORD` z env (emituje `generate-secrets.mjs`).
⚠️ **Appsmith API token pro Aishu zatím nevystaven** (deliverable Fáze 0 v `docs/MASTER_PLAN.md`) — bez něj operace fungují jen lokálně s vlastním API key.
⚠️ **Git sync → git repo konfigurací Appsmithu zatím nepropojen** (Fáze 1.1 + `docs/AUTONOMY_PLAN.md` Fáze D) — `git_sync` operace existuje, ale prod aplikace nemá připojený Git repo.
⚠️ **StoryLoop dashboard wireframe zatím neexistuje** — vznikne ve WP-02 (`docs/planning/DELEGATION_PLAN.md` §5); sekce a datové zdroje jsou specifikované v `docs/MASTER_PLAN.md` §1.2 (dashboard volá Supabase RPC, nikdy `.from()`).

## Gates / validace

| Kontrola | Příkaz |
|---|---|
| Dashboard templates + widget katalog + builder WF + secrets/emoji | `npm run test:gates -- appsmith-dashboard` |
| Story Intra templates + intranet proxy allowlist + domain zoning | `npm run test:gates -- appsmith-intranet` |
| Producer/consumer parita templates ↔ builder | `npm run test:gates -- aisha-appsmith-importer` |
| MCP tool kontrakt (`admin_appsmith`, `admin_appsmith_manage` registrovány + schema) | `npx vitest run src/tests/mcp/mcp-tool-contract.test.ts` |
| AishaAdminBridge node unit testy | `npm --prefix packages/n8n-nodes-aisha test` |
| Builder dry-run (render bez side-effectů) | `node scripts/build-aisha-appsmith.mjs --dry-run` |
| Datasource provisioning | `npm run appsmith:provision` |
| E2E MCP admin tools (tools/list + tool calls) | `e2e/mcp-admin-tools.spec.ts` (Playwright) |

Před commitem změn v `appsmith/`, builderu nebo AishaAdminBridge spusť minimálně tři gate příkazy výše + node testy.

## Související

- **`aisha-n8n-workflow`** — orchestrace connector operací ve WF (approval gate, audit, idempotence)
- **`aisha-deploy-flow`** — Phase 4 autonomous deploy flow používá dashboard regeneraci (AISHA Ops)
- **`aisha-nocodb-view`** — NocoDB jako analytický backend pro dashboard data (WP-03)
- **`aisha-rpc`** — RPC funkce, které dashboardy volají jako datasource queries
- `docs/deploy/APPSMITH_AISHA_OPS.md`, `docs/release/AISHA_APPSMITH_DEPLOY.md` — deploy specs
- `docs/MASTER_PLAN.md` (Fáze 0, Fáze 1.2, §7.3 Modul 3), `docs/AUTONOMY_PLAN.md` (Fáze D)
