# APPSMITH_AISHA_OPS.md — Phase 4: AISHA's Self-Reflective Dashboard

> **Status:** SPEC — Phase 4 z [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md)
> **Verze:** 1.0
> **Datum:** 2026-04-28

---

## TL;DR

AISHA si **sama vytváří a regeneruje** Appsmith dashboard. Není to nástroj, který "dáváme AISHE k dispozici" — je to její **reflective surface**: ona pozoruje sebe sama (drift, B/G slots, Sentry signály, n8n executions, Langfuse traces) a publikuje pozorování přes UI, kterou si sama designs.

**Hybrid model**: ručně vytvořená template (kostra layout + datasource refs) + dynamicky generované widgety podle aktuálního stavu observability stacku. Když přibude nový n8n workflow nebo Sentry projekt, dashboard se sám obnoví v dalším cyklu (30 min) a zahrne nový widget.

---

## 1. Princip: AISHA jako vlastník dashboardu

### 1.1 Co znamená "AISHA-driven"

| Tradiční dashboard | AISHA-driven dashboard |
|---|---|
| Hand-coded React app | Generated z observability state |
| Statický layout | Adaptivní layout (per-source widget) |
| Manuální update při změnách | Auto-regenerace při změně zdrojů |
| Devops vlastní kód | AISHA vlastní layout + queries |
| Změna = PR, review, merge | Změna = AISHA si přepíše template + idempotent re-import |

**Důsledek**: spec definuje **template** a **builder workflow**, ne final dashboard JSON. AISHA dashboard JSON v každém cyklu vyrenderuje.

### 1.2 Granularita autonomního chování

Co AISHA může **autonomně** měnit:
- Přidat widget pro nově detekovaný n8n workflow (low risk)
- Přidat row do tabulky pro nově registered integration_service (low risk)
- Změnit query pokud RPC schema se změní (low risk, jen read-only queries)

Co AISHA **musí** mít approval:
- Změna theme nebo brand colors (medium — vizuální change)
- Přidání new datasource (medium — auth/permissions impact)
- Přidání action button s admin role (high — bezpečnostně relevantní)
- Smazání existing page (high — možná data loss in user bookmarks)

V praxi: dashboard rebuild běží low-risk vždy, ale builder workflow detekuje "structural" změny a eskaluje.

---

## 2. Komponenty

### 2.1 `appsmith/dashboards/aisha-ops.template.json`

Ručně vytvořená kostra dashboardu, exportovaná z Appsmith UI po jednorázovém manuálním sestavení. Obsahuje:

- App-level config: `name: "AISHA Ops"`, `icon: "dashboard"`, `color: "#4F46E5"`
- Workspace ID placeholder: `"workspaceId": "{{WORKSPACE_ID}}"`
- Theme settings (colors, fonts, primary action button styles)
- Datasource references (REST API endpoints — abstrakce za reálné URL)
- Page skeletons (jen empty containers, widgety builder doplní)
- Default page navigation strukturu

> **Bootstrap workflow**: jeden human admin manuálně postaví "first-cycle" dashboard v Appsmith UI, exportuje JSON přes `/api/v1/applications/export/{appId}`, uloží jako template. Builder pak template plní data.

### 2.2 `appsmith/widgets/` — Widget Catalog

Re-použitelné widget JSON snippets, parametrizované přes Mustache-style placeholdery:

| Soubor | Účel | Parametry |
|---|---|---|
| `widgets/table.json` | TableWidget pro RPC výsledky | `{{title}}`, `{{query_name}}`, `{{columns_json}}` |
| `widgets/statbox.json` | StatBoxWidget pro count metrics | `{{title}}`, `{{value_query}}`, `{{label}}`, `{{color}}` |
| `widgets/iframe.json` | IframeWidget pro embedded UIs (Dozzle, Sentry, n8n) | `{{src}}`, `{{height}}` |
| `widgets/button.json` | ButtonWidget pro action triggers | `{{label}}`, `{{webhook_url}}`, `{{role_required}}` |
| `widgets/chart-bar.json` | ChartWidget bar chart | `{{title}}`, `{{query_name}}`, `{{x_field}}`, `{{y_field}}` |
| `widgets/chart-line.json` | ChartWidget line chart (timeline) | `{{title}}`, `{{query_name}}`, `{{x_field}}`, `{{y_field}}` |
| `widgets/text-status.json` | TextWidget se status indicator (color by value) | `{{label}}`, `{{value}}`, `{{status_map_json}}` |

Substituce probíhá v builder workflow (Mustache).

### 2.3 `n8n/workflows/WF_APPSMITH_DASHBOARD_BUILDER.json`

Workflow kroky:

```
1. trigger:
   ├─ scheduleTrigger (every 30 min) -- regular cycle
   └─ webhook (manual rebuild — POST /webhook/appsmith-rebuild)
2. code: Discover Sources
   ├─ HTTP GET n8n /api/v1/workflows → list of active workflows
   ├─ aishaRpc: list_integration_services
   ├─ aishaRpc: get_sentry_monitor_configs
   ├─ aishaRpc: get_active_slots
   ├─ aishaRpc: get_latest_drift_state (recent 50)
   ├─ HTTP GET Coolify /api/applications
   └─ aishaRpc: get_pending_rollback_count
3. code: Load Template + Widgets
   ├─ readFile appsmith/dashboards/aisha-ops.template.json
   └─ readFile each appsmith/widgets/*.json
4. code: Render Pages × Widgets
   ├─ For each page → for each section → render widgets
   ├─ Mustache substitute placeholders s discovered data
   └─ Compute deterministic widget IDs: widget-{section}-{source_slug}
5. code: Compute Content Hash
   └─ SHA-256 of rendered_dashboard_json
6. aishaRpc: get_last_dashboard_hash
   └─ Compare s current hash
7. if: hash differs?
   ├─ no → noOp + log "no changes"
   └─ yes → continue
8. aishaRpc: fn_evaluate_proposal_risk('dashboard_rebuild', metadata)
   └─ Vždy 'low' (read-only, regenerable)
9. httpRequest: Login Appsmith
   └─ POST /api/v1/login (admin credentials z env)
10. httpRequest: Import Dashboard
    └─ POST /api/v1/applications/import/{workspaceId}
       Content-Type: multipart/form-data
       Body: rendered_dashboard_json
11. httpRequest: Publish Dashboard
    └─ POST /api/v1/applications/publish/{appId}
12. aishaRpc: store_dashboard_hash
13. log_integration_action('appsmith_dashboard_rebuild', detail, status)
```

### 2.4 `scripts/provision-appsmith.sh` (extended)

Existing skript provisuje "StoryLoop Dashboard". Phase 4 ho rozšiřuje o sekci "AISHA Ops":

```bash
# Existing sections preserved (StoryLoop)
section "11. AISHA Ops Dashboard"
# 1. Check if AISHA Ops app exists
# 2. If no: trigger first-time builder run
# 3. If yes: skip (subsequent runs handled by WF_APPSMITH_DASHBOARD_BUILDER)
```

### 2.5 `src/tests/gates/appsmith-dashboard.gate.test.ts`

Static analysis gate test ověřující:
1. Template JSON je valid (parses + má requirovaná pole)
2. Všechny widget templates parsují + obsahují validní placeholder syntax
3. Builder workflow JSON je valid + odkazuje na existující widget templates
4. Idempotency check: dvě po sobě jdoucí builds se stejným input vyrobí stejný output
5. No hardcoded URLs (everything via env vars / config)
6. No emoji v dashboard JSON (CLAUDE.md rule — i18n + lucide icons)
7. Action buttons mají `role_required` field

---

## 3. Pages a widget rozložení

### 3.1 Page: Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AISHA Ops — Overview                                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Active   │ │ Drift    │ │ Sentry   │ │ Pending  │       │
│  │ Slots    │ │ Unresolv │ │ Critical │ │ Approvls │       │
│  │   12 ✓   │ │   3 ⚠    │ │   1 ⚠    │ │   2 ⏳   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│  Recent B/G Switches (last 10)                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Time  | App           | From → To | Image Tag | Status│ │
│  │ ...   | aisha-gateway | blue→green| sha-def456| ✓     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Recent Drift Detections (last 10)                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Time | App | Kind | Risk | Status                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Top Sentry Issues (last 24h)                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Time | App | Title | Level | Count | Users              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

Widget IDs:
- `widget-overview-statbox-active-slots`
- `widget-overview-statbox-drift`
- `widget-overview-statbox-sentry`
- `widget-overview-statbox-approvals`
- `widget-overview-table-bg-switches`
- `widget-overview-table-drift`
- `widget-overview-table-sentry`

### 3.2 Page: Per-Story

Filter dropdown: vybere story_id. Defaultně AISHA-stack story.

Sekce:
- Story metadata (slug, owner, status)
- 3 environments (preview/staging/prod) — current state, last_deployed_at, image_tag
- Recent deploys for this story (TableWidget)
- Recent Langfuse traces filtered by story (TableWidget)
- Action buttons (admin only): "Deploy preview", "Deploy staging", "Deploy prod" → POST n8n webhook `deploy-story`

### 3.3 Page: n8n

- TableWidget: all active workflows (z n8n /api/v1/workflows)
- TableWidget: recent executions (z n8n /api/v1/executions, last 100)
- TableWidget: B/G switches (z `audit_journal` filtered by action='blue_green_switch')
- TableWidget: drift remediations (z `audit_journal` action='drift_auto_remediate')
- ChartWidget: executions per workflow per 24h (bar)

### 3.4 Page: Sentry

- StatBoxWidgets: fatal/error/warning counts (last 24h)
- TableWidget: top 20 issues
- TableWidget: rollback history (z `rollback_history`)
- ChartWidget: issues × deploys timeline (line + dotted vertical lines for switches)
- IframeWidget: Sentry UI embed (read-only `${SENTRY_URL}/aisha/<project>/issues/`)

### 3.5 Page: Langfuse

- StatBoxWidgets: total traces (24h), avg latency, total cost
- TableWidget: recent traces s anomáliemi (high latency, high cost, low score)
- ChartWidget: cost per workflow per 24h
- IframeWidget: Langfuse UI embed (`https://langfuse.backend.id3a.cz/project/<id>/traces`)

### 3.6 Page: Logs

- IframeWidget: Dozzle (read-only embed `https://logs.frontend.id3a.cz`)
- Filter dropdowns for app + level
- Note: Dozzle nemá REST API → jen embed, žádné querying

### 3.7 Page: Actions

**Pouze admin** (kontrolováno via `is_user_admin` RPC):

- ButtonWidget: "Run drift check now" → POST `/webhook/drift-now`
- ButtonWidget: "Force B/G switch" → form (app_name, target_slot) → POST `/webhook/blue-green-switch`
- ButtonWidget: "Trigger Sentry observer" → POST `/webhook/sentry-observer-now`
- ButtonWidget: "Rebuild dashboard" → POST `/webhook/appsmith-rebuild`
- ButtonWidget: "Deploy AISHA preview" → POST `/webhook/deploy-story` body `{ story_id: 'aisha-stack', environment: 'preview', force: false }`

Each action button má `role_required: 'admin'` field — Appsmith zobrazí jen pokud `appsmith.user.roles` contains 'admin'.

---

## 4. Datasources

### 4.1 Postgres REST API (PostgREST)

Primary datasource. Endpoints přes RPC volání:

| RPC | Purpose | Page |
|---|---|---|
| `get_active_slots()` | B/G state | Overview, Per-Story |
| `get_latest_drift_state(p_limit)` | Drift table | Overview, n8n |
| `get_unresolved_drift_count()` | StatBox | Overview |
| `get_pending_rollback_count()` | StatBox | Overview |
| `get_pending_approval_count()` | StatBox | Overview |
| `correlate_sentry_with_deploys(p_window_min)` | Sentry × deploys | Sentry |
| `list_integration_services()` | Integration health | n8n, Overview |
| `get_audit_journal(p_limit, p_offset, p_action_filter)` | Recent activity | n8n |
| `get_recent_b_g_switches(p_limit)` | B/G timeline | Overview, n8n |
| `get_rollback_history(p_limit)` | Rollback table | Sentry |
| `get_dashboard_token_for_session()` | Dashboard data scope token | All (validation) |

### 4.2 n8n REST API

Direct calls do `n8n.aisha.guru/api/v1/`:
- `GET /workflows?active=true` → list active workflows
- `GET /executions?limit=100&status=success` → recent executions
- `GET /executions?limit=20&status=error` → recent errors

Auth: `X-N8N-API-KEY: ${N8N_API_KEY}` header. API key uložen v Appsmith datasource secret.

### 4.3 Coolify REST API

Direct calls do Coolify API:
- `GET /api/v1/applications` → list apps
- `GET /api/v1/applications/{uuid}/deployments?per_page=1` → last deployment per app

Auth: `Authorization: Bearer ${COOLIFY_API_TOKEN}`.

### 4.4 Sentry REST API

Calls do `${SENTRY_URL}/api/0/`:
- `GET /projects/aisha/{project_slug}/issues/?statsPeriod=24h&query=is:unresolved` → top issues

Auth: `Authorization: Bearer ${SENTRY_AUTH_TOKEN}`.

### 4.5 Langfuse REST API

Calls do `langfuse.backend.id3a.cz/api/public/`:
- `GET /traces?limit=50` → recent traces
- `GET /scores?limit=50` → recent scores

Auth: Basic Auth s `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`.

---

## 5. Auth & RBAC

### 5.1 Dashboard access

- Příchod přes `appsmith.backend.id3a.cz` → OAuth2 Proxy → Keycloak SSO
- OAuth2 Proxy injectuje `X-Forwarded-Access-Token`, `X-Forwarded-User`, `X-Forwarded-Email`
- Appsmith čte tyto headers a mapuje na user identity
- `OAUTH2_PROXY_ALLOWED_GROUPS: admin,staff` — basic gate
- All `read-only` widgets visible všem (admin + staff)

### 5.2 Action button gating

Action buttons jsou viditelné pouze adminům. Mechanism:

1. Widget JSON obsahuje `dynamicHidden: "{{ !appsmith.user.roles?.includes('admin') }}"`
2. Builder workflow rozhoduje `role_required` field při render
3. n8n webhook (target action) **dvakrát** validuje:
   - Header `X-Forwarded-Access-Token` extracted JWT
   - RPC `is_user_admin(token)` → `boolean`
   - Pokud false: 403 + log_integration_action('unauthorized_action_attempt', ...)

> **Důvod dvou-vrstvého gating**: Appsmith UI hide je convenience (UX), ale n8n webhook je security gate (bezpečnostně relevantní).

### 5.3 Audit logging

Každá action button click loguje:
- `audit_journal` row: `action='dashboard_action_triggered'`, `metadata={button_id, user_id, timestamp, payload}`
- `integration_actions` row: `service_name='appsmith'`, `action='button_click'`, `status='success|denied|failed'`

---

## 6. Idempotency & content hash

### 6.1 Hash compute

```typescript
import crypto from 'crypto';

function dashboardContentHash(rendered: object): string {
  // Stable stringify (sorted keys) for deterministic hash
  const stable = stableStringify(rendered);
  return crypto.createHash('sha256').update(stable).digest('hex');
}
```

### 6.2 Skip-if-unchanged

```sql
CREATE TABLE dashboard_render_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rendered_at  timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  triggered_by text,                 -- 'cron_30min' | 'manual_webhook'
  diff_summary jsonb,                -- which sections changed
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- RPC
CREATE FUNCTION get_last_dashboard_hash() RETURNS text ...
CREATE FUNCTION store_dashboard_hash(p_hash text, p_triggered_by text, p_diff jsonb) RETURNS void ...
```

Workflow:
1. Compute hash
2. Compare s `get_last_dashboard_hash()`
3. Pokud match → skip POST import (no-op)
4. Pokud differ → POST import, then `store_dashboard_hash()`

### 6.3 Diff summary

Pro debugging:
```json
{
  "added": ["widget-n8n-table-WF_NEW_WORKFLOW"],
  "removed": [],
  "modified": ["widget-overview-statbox-drift"]  -- count value changed
}
```

---

## 7. Failure modes a recovery

| Failure | Detection | Recovery |
|---|---|---|
| Appsmith API down | HTTP 5xx / timeout v step 9-11 | Retry 3x exponential backoff, pak skip cycle, log |
| Workspace ID missing | env var unset | Workflow exits early s explicit error log |
| Rendered JSON invalid (Appsmith refuses) | HTTP 400 import response | Log full payload + error, alert dirigent |
| Datasource RPC fails | aishaRpc errors | Continue with partial data, mark `partial_render: true` v output |
| Login session expired | HTTP 401 v step 9 | Re-login, retry |
| Race: two builders run simultaneously | Hash compare detects no-op (both render same hash) | Self-healing — second one skips |

### 7.1 Manual recovery

Admin může:
- Vyvolat manual rebuild via "Rebuild dashboard" action button
- Bypass hash check via `?force=true` query param na webhook
- Restore previous version: `POST /api/v1/applications/import/{workspaceId}` s starší verzi z `dashboard_render_history` (history má raw JSON archiv via S3 link — TBD při implementaci)

---

## 8. Phased deployment

### 8.1 First-cycle (initial bootstrap)

1. Admin manuálně postaví dashboard v Appsmith UI (následuje README v `appsmith/dashboards/README.md`)
2. Export přes API: `GET /api/v1/applications/export/{appId}` → save as `aisha-ops.template.json`
3. Run `WF_APPSMITH_DASHBOARD_BUILDER` jednou (manual webhook)
4. Builder rozšíří widgety podle skutečných zdrojů
5. Verify v UI

### 8.2 Subsequent cycles (autonomous)

- Cron 30 min spouští builder
- Hash compare → skip pokud unchanged
- Audit log za každý cyklus
- Phase 4 dashboard sám sebe zobrazuje (StatBoxWidget "Last rebuild" + "Last hash")

---

## 9. Konfigurace

| Env var | Default | Účel |
|---|---|---|
| `APPSMITH_AISHA_WORKSPACE_ID` | required | Workspace ID v Appsmith |
| `APPSMITH_AISHA_APP_ID` | populated by builder | App ID po prvním importu |
| `APPSMITH_DASHBOARD_REBUILD_INTERVAL_MIN` | `30` | Cron interval |
| `APPSMITH_ADMIN_EMAIL` | (required) | Login pro builder workflow |
| `APPSMITH_ADMIN_PASSWORD` | (required, secret) | Pro builder login |
| `APPSMITH_DASHBOARD_FORCE_REBUILD` | `false` | Bypass hash check |
| `APPSMITH_DASHBOARD_DRY_RUN` | `false` | Render but don't import |

---

## 10. Otevřené otázky

1. **WebSocket real-time push** (out-of-scope V1): aktuálně 30min polling. V2 zvážit Appsmith real-time queries přes WebSocket / SSE z PostgREST.
2. **Dashboard versioning**: kdo má přístup k historickým renderingem? Kde uložit (DB jsonb? S3 archiv?). — *přidat v R6 implementaci, pokud rozsah dovolí*
3. **Multi-tenant dashboards**: aktuálně jeden AISHA Ops dashboard. Pro každý zákazníkův AISHA stack (open-source instance) by mělo smysl vlastní instance. Mimo scope tohoto dokumentu.
4. **Custom Appsmith plugin pro embedded n8n iframe** (out-of-scope): n8n má X-Frame-Options omezení. V1 řeší přes link, ne iframe.

---

## 11. Reference

- [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md) — master spec
- [DRIFT_OBSERVER.md](DRIFT_OBSERVER.md) — Phase 1 data zdroj
- [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) — Phase 2 data zdroj
- [SENTRY_OBSERVER.md](SENTRY_OBSERVER.md) — Phase 3 data zdroj
- [APPSMITH.md](APPSMITH.md) — Appsmith deploy a setup guide
- [WF_NODE_FACTORY.json](../../n8n/workflows/WF_NODE_FACTORY.json) — pattern pro idempotent regenerable workflow
- [Appsmith API: Export/Import applications](https://docs.appsmith.com/reference/rest-api)
