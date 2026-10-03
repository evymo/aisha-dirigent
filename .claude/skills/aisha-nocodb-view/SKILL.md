---
name: aisha-nocodb-view
description: Operate NocoDB as the AISHA analytical backend ("analytický backend") — create/update views and tables via the NocoDB REST API ("nocodb api") or the AishaAdminBridge n8n node ("admin bridge"), write analytical data, and manage Aisha's management board. Use when creating a "nocodb view", adding an analytical table, wiring NocoDB record CRUD into a workflow, or debugging NocoDB API calls. Triggers on "nocodb", "nocodb view", "nocodb table", "admin bridge", "analytický backend", "nocodb api", "management board".
---

# AISHA NocoDB View Skill

V tomto repu je **NocoDB analytický backend** AISHA platformy — "Aisha's hands" pro práci s daty (viz `docs/MASTER_PLAN.md`, sekce NocoDB ↔ Appsmith). NocoDB sedí nad sdílenou PostgreSQL (Supabase PG) a Aisha přes jeho REST API vytváří/upravuje **views a tabulky**, zapisuje **analytická data** (performance reporty, deploy reporty) a spravuje vlastní **management board**. Frontend dashboardy dělá Appsmith; NocoDB dělá datové struktury a spreadsheet/grid/kanban views.

Existují **tři cesty**, jak s NocoDB pracovat — všechny jsou v repu reálně implementované:

1. **`AishaAdminBridge` n8n node** — `packages/n8n-nodes-aisha/nodes/AishaAdminBridge/AishaAdminBridge.node.ts` (service `nocodb`, 8 operací) — pro workflow orchestraci.
2. **Idempotentní setup skript** — `scripts/aisha-nocodb-views-setup.mjs` (`npm run aisha:nocodb:views`) — pro deklarativní seznam analytických views verzovaný v repu.
3. **MCP admin tools** (`admin_nocodb_query`, `admin_nocodb_manage`) — plná implementace je zatím jen v legacy referenci `trash/legacy-archive/edge-functions-reference/mcp-knowledge-server/index.ts`; živý `services/svc-mcp-knowledge/src/routes/mcp.ts` má z admin bridge zatím jen `admin_health_check` (migrace ostatních je TODO v hlavičce souboru). Nepředstírej, že MCP cesta v runtime funguje — pro reálné operace použij cestu 1 nebo 2.

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Nový analytický view nad existující tabulkou (grid/form/gallery/kanban) | **Ano** — přidej entry do `VIEWS` v `scripts/aisha-nocodb-views-setup.mjs` |
| NocoDB operace uvnitř n8n workflow (create view, CRUD record) | **Ano** — `AishaAdminBridge` node, service `nocodb` |
| Zápis analytických dat (performance report, deploy report) do NocoDB | **Ano** — `create_record` přes AishaAdminBridge |
| Management board operace (Aisha si upravuje vlastní board) | **Ano** — viz `docs/MASTER_PLAN.md` + `WF_DIRIGENT_AGENT.json` playbooks |
| Appsmith dashboard / UI vrstva nad NocoDB daty | **Ne** — skill `aisha-appsmith-connector` (`.claude/skills/aisha-appsmith-connector/SKILL.md`; vznikl v rámci WP-02, `docs/planning/DELEGATION_PLAN.md` §6.1) |
| Auditovaný přístup k datům platformy (RPC, RLS, audit trail) | **Ne** — skill `aisha-rpc`; NocoDB nikdy neobchází RPC-only pravidlo pro aplikační data |
| Nový n8n workflow kolem NocoDB (trigger, approval gate, audit) | **Ne** — skill `aisha-n8n-workflow`; tento skill řeší jen NocoDB operace uvnitř |
| Nová PG tabulka / schema změna, kterou má NocoDB zobrazit | **Ne** — skill `aisha-migration` (SoT v `aisha/db/sql/`), NocoDB ji pak jen "uvidí" |

## Architektura: kde NocoDB žije

- **Produkce:** `docker-compose.coolify-admin.yml` — service `nocodb` (container `aisha-nocodb`, `NC_DB=pg://aisha-db:5432` s uživatelem `nocodb_app`). Veřejná routa jde **přímo** Traefik → `nocodb:8080` (Traefik labels sedí na `nocodb` service, `loadbalancer.server.port=8080`) — OAuth se na veřejné cestě záměrně obchází (spec: `src/tests/gates/admin-routing-integral.gate.test.ts`), mitigace `NC_ADMIN_EMAIL` pre-create + `NC_INVITE_ONLY_SIGNUP=true`. OAuth2 proxy `nocodb-auth:4180` existuje jen jako opt-in interní cesta pro volající, kteří na ni explicitně jdou (`http://nocodb-auth:4180`). NocoDB **není** v `docker-compose.local.yml` — lokálně se připojuješ na produkční/staging instanci přes env.
- **Env:** `NOCODB_URL` + `NOCODB_API_TOKEN` v `.env.aisha` (šablona `.env.aisha.example`, řádky `NOCODB_URL=http://localhost:8080`, `NOCODB_API_TOKEN=`). Nikdy nehardcoduj host ani token.
- **Registr služeb:** NocoDB je registrovaná v tabulce `integration_services` (SoT `aisha/db/sql/tables/integration_services.sql`); každá admin operace se audituje do `integration_service_logs` přes RPC `log_integration_action` (SoT `aisha/db/sql/functions/log_integration_action.sql`).
- **Plán rozšíření:** `docs/AUTONOMY_PLAN.md` Fáze C — ~17 admin stránek se nahrazuje NocoDB views (C1 CRUD, C2 content, C3 operational). `docs/AISHA_ADMIN_INTEGRATION.md` je aktivní referenční dokument celého admin bridge.

## Kanonický vzor 1 — deklarativní view přes setup skript (preferovaná cesta)

Analytické views se verzují jako data v `scripts/aisha-nocodb-views-setup.mjs` (konstanta `VIEWS`). Skript je idempotentní — existující views přeskočí. Přidání nového view = jeden objekt:

```js
// scripts/aisha-nocodb-views-setup.mjs — přidej do VIEWS
{
  table: "integration_services",           // titul tabulky v NocoDB (mapuje se na tableId)
  view_name: "integration_health",         // unikátní název view
  description: "Integration services health status dashboard",
  type: "grid",                            // grid | form (skript zatím mapuje jen grid=3, jinak 1)
  sort: [{ field: "service_name", direction: "asc" }],
},
```

Spuštění:

```bash
npm run aisha:nocodb:views:dry      # dry-run — co by se vytvořilo
npm run aisha:nocodb:views:status   # jen výpis existujících views
npm run aisha:nocodb:views          # skutečné vytvoření
```

Skript volá `GET /api/v1/db/meta/projects/` → `GET /api/v1/db/meta/projects/{baseId}/tables` → `POST /api/v1/db/meta/tables/{tableId}/views` a sorty přes `POST /api/v1/db/meta/views/{viewId}/sorts` (best-effort).

## Kanonický vzor 2 — NocoDB operace přes AishaAdminBridge (n8n)

Node `aishaAdminBridge` (`packages/n8n-nodes-aisha/nodes/AishaAdminBridge/AishaAdminBridge.node.ts`), credential `aishaNocoDbApi` (`packages/n8n-nodes-aisha/credentials/AishaNocoDbApi.credentials.ts` — pole `baseUrl`, `apiToken`). Handler je **standalone funkce** `executeNocoDBOps(ctx, itemIndex, operation)` — n8n runtime rebinduje `this`, private metody nefungují.

| Operace | Endpoint | Parametry |
|---|---|---|
| `list_tables` | `GET /api/v1/meta/bases` | — |
| `get_schema` | `GET /api/v1/meta/tables/{tableId}` | `tableId` |
| `list_records` | `GET /api/v1/db/data/noco/{tableId}` | `tableId`, `limit`, `offset`, `where` např. `(status,eq,active)` |
| `create_record` | `POST /api/v1/db/data/noco/{tableId}` | `tableId`, `recordData` (JSON) |
| `update_record` | `PATCH /api/v1/db/data/noco/{tableId}/{recordId}` | `tableId`, `recordId`, `recordData` |
| `delete_record` | `DELETE /api/v1/db/data/noco/{tableId}/{recordId}` | `tableId`, `recordId` — **vyžaduje approval gate** |
| `create_view` | `POST /api/v1/meta/tables/{tableId}/views` | `tableId`, `viewName`, `viewType` (grid/form/gallery/kanban) |
| `run_formula` | *(stub — žádný HTTP call)* | vrací jen `{ formula, note }`, viz pitfalls |

Auth header: `xc-token: <apiToken>`. View typy se mapují na čísla: `grid=3, form=1, gallery=2, kanban=5`.

Orchestrace zvenčí: `n8n/workflows/WF_ADMIN_ORCHESTRATION.json` — webhook `POST /webhook/admin-bridge` s tělem `{ "service": "nocodb", "operation": "list_tables", "params": {} }` → route → větev `nocodb-ops` (node `n8n-nodes-aisha.aishaAdminBridge`) → audit log; to je referenční příklad tohoto vzoru. Pozor: `n8n/workflows/WF_LANGFUSE_PERFORMANCE_REVIEW.json` (denní report do NocoDB) AishaAdminBridge **nepoužívá** — jeho node "Store Report in NocoDB" je `httpRequest` posílající JSON-RPC `admin_nocodb_manage` na MCP endpoint, tj. legacy MCP cesta (3), která v živém `svc-mcp-knowledge` zatím není zmigrovaná (viz pitfalls). Podobně Dirigent (`n8n/workflows/WF_DIRIGENT_AGENT.json`) má playbooks Performance Review a Approval Gate Response, které NocoDB čtou/zapisují přes `admin_nocodb_query` / `admin_nocodb_manage` tool-wrappery.

## Kanonický vzor 3 — management board

Aisha si dle `docs/MASTER_PLAN.md` modifikuje vlastní management board v NocoDB přes NocoDB API v AishaAdminBridge: detekce potřeby → NocoDB (view/struktura) → Appsmith (dashboard) → n8n (workflow). Boardové tabulky (`stories`, `integration_services`, `ai_sessions`, `ai_trace_events`, `story_entries`, `agent_catalog`, `story_reminders`) už mají views definované ve `VIEWS` v `scripts/aisha-nocodb-views-setup.mjs` — nové boardy přidávej tam, ne ručně v UI. Cross-referencing s Appsmith řeší skill `aisha-appsmith-connector` (vznikl v rámci WP-02).

## Common pitfalls

- ❌ **`xc-auth` vs `xc-token`**: AishaAdminBridge posílá API token v headeru `xc-token`; `scripts/aisha-nocodb-views-setup.mjs` používá `xc-auth`. Při 401 z NocoDB zkontroluj, který header instance pro API tokeny akceptuje — pro API tokeny je kanonický `xc-token`.
- ❌ **`run_formula` není reálná operace** — NocoDB nemá endpoint pro spuštění formule; operace vrací jen echo `{ formula, note }`. Agregace řeš přes formula column v meta API nebo přes `list_records` + výpočet ve workflow.
- ❌ **Credential se jmenuje `aishaNocoDbApi`** — tabulka credentials v `docs/AISHA_ADMIN_INTEGRATION.md` uvádí starší `evymoNocoDbApi`; zdrojem pravdy je `packages/n8n-nodes-aisha/credentials/AishaNocoDbApi.credentials.ts`.
- ❌ **NocoDB lokálně neběží z `docker-compose.local.yml`** — zmínka v `docs/AISHA_ADMIN_INTEGRATION.md` o `--profile admin` je zastaralá; produkční deploy je `docker-compose.coolify-admin.yml`, kde veřejná routa jde Traefik → `nocodb:8080` **přímo** (ne přes `nocodb-auth`; ten poslouchá na 4180 a je jen opt-in interní OAuth cesta — viz `src/tests/gates/admin-routing-integral.gate.test.ts`).
- ❌ **MCP tools `admin_nocodb_query`/`admin_nocodb_manage` v živém `services/svc-mcp-knowledge` zatím nejsou** — jsou jen v legacy referenci a v contract testu; nezakládej na nich runtime integraci, dokud migrace neproběhne.
- ❌ **`tableId` není název tabulky** — je to NocoDB meta ID; získej ho přes `list_tables`/`get_schema` (setup skript mapuje title → id automaticky).
- ❌ **DELETE bez approval gate** — destruktivní NocoDB operace musí projít `WF_APPROVAL_GATE` (viz bezpečnostní invarianty v `WF_DIRIGENT_AGENT.json` §9); advisory hooks nedenymují, ale review to vrátí.
- ❌ **Obcházení RPC-only pravidla** — NocoDB je pro analytická/board data; aplikační mutace jdou přes audited RPC (skill `aisha-rpc`), ne přes `create_record` na produkčních tabulkách.
- ❌ **Hardcoded host/token** — vždy `NOCODB_URL`/`NOCODB_API_TOKEN` z `.env.aisha`; skript i node validují prázdný token a selžou brzy.
- ❌ **Zapomenutý audit** — každá admin bridge operace loguje přes RPC `log_integration_action` do `integration_service_logs`; při nové workflow větvi audit node nevynechávej.

## Gates / validace

```bash
# 1. Dry-run view setupu — ověří env + co by se vytvořilo (bez zápisu)
npm run aisha:nocodb:views:dry

# 2. Stav existujících views
npm run aisha:nocodb:views:status

# 3. Unit testy AishaAdminBridge (NocoDB ops, credentials, error handling)
cd packages/n8n-nodes-aisha && npx vitest run __tests__/AishaAdminBridge.test.ts

# 4. MCP tool contract (admin_nocodb_query/manage → správné RPC mapování)
npx vitest run src/tests/mcp/mcp-tool-contract.test.ts

# 5. Integrita n8n workflow JSONů (pokud jsi sahal na WF_ADMIN_*)
npx vitest run src/tests/gates/n8n-workflow-integrity.gate.test.ts

# 6. Celá integrační pipeline (obsahuje NocoDB health check /api/v1/health)
npm run aisha:integration
```

Health endpoint NocoDB je `/api/v1/health` — používá ho `scripts/test-aisha-integration.mjs` i health operace AishaAdminBridge.

## Související

- **`aisha-rpc`** — audited SECURITY DEFINER RPC (`list_integration_services`, `log_integration_action`, `update_integration_health` — SoT v `aisha/db/sql/functions/`)
- **`aisha-n8n-workflow`** — orchestrace NocoDB operací ve WF_* workflow (approval gate, audit trail)
- **`aisha-migration`** — nové PG tabulky, které má NocoDB zobrazovat (SoT `aisha/db/sql/`)
- **`aisha-appsmith-connector`** — frontend/dashboard vrstva nad NocoDB daty (Appsmith REST API + Git sync, MCP tools `admin_appsmith`/`admin_appsmith_manage`); vznikl v rámci WP-02 (`docs/planning/DELEGATION_PLAN.md` §6.1)
- **`docs/AISHA_ADMIN_INTEGRATION.md`** — aktivní reference NocoDB + Langfuse admin bridge
- **`docs/AUTONOMY_PLAN.md` Fáze C** — roadmapa NocoDB views (~17 admin stránek)
- **`docs/MASTER_PLAN.md`** — NocoDB ↔ Appsmith bidirectional flow, Aisha jako Dirigent ekosystému
