# AISHA Autonomous Deploy Flow

> **Status:** Implementation in progress (Phase 0-4 + META-2)
> **Verze:** 2.0 (merged 2026-04-29)
>
> Document combines two converging design tracks:
> 1. **Operational flow** (developer git push → AISHA autonomously deploys, monitors, rolls back)
> 2. **Architectural detail** (Phase 0-4 with state machines, RPCs, decision provenance, META-2 self-tooling)
>
> Pro orientaci: Část 1 popisuje "co AISHA dělá v happy path" (procesní pohled).
> Část 2 popisuje "jak je to implementované" (datové struktury, RPC contracts, gate criteria).

---

# Část 1: Operational flow (event-driven happy path)

# AISHA Autonomous Deploy Flow

> Jak AISHA **sama** řídí deploy lifecycle: monitoring přes Sentry → analýza →
> fix v sandbox → B/G deploy → smoke → promote/rollback. Žádný operator
> v happy path.

## Princip

**Operator nedeploynu apps. AISHA dělá.** Operator pouze:
1. Pushne kód do gitu
2. Sleduje n8n executions UI nebo Sentry releases dashboard
3. Zasáhne **jen** v incident response (n8n alerts)

Vše ostatní je autonomní.

## End-to-end flow

```
                          ┌─────────────┐
                          │ Developer   │
                          │   git push  │
                          └──────┬──────┘
                                 │
                                 ▼
                          ┌─────────────┐
                          │   Forgejo   │
                          │   webhook   │ → POST /webhook/coolify-deploy
                          └──────┬──────┘
                                 │
                  ┌──────────────┴──────────────┐
                  │                             │
                  ▼                             ▼
         ┌────────────────┐          ┌──────────────────────┐
         │   Coolify      │          │ aisha-changed-apps   │
         │ webhook fires  │          │ (CI step or WF)      │
         │   per app      │          └──────────────────────┘
         └───────┬────────┘                     │
                 │                              │
                 │     POST /webhook/coolify-bg-orchestrate
                 │                              │
                 ▼                              │
         ┌──────────────────────────────────────┴───────┐
         │       n8n: WF_BLUE_GREEN_ORCHESTRATOR        │
         │                                              │
         │  1. Parse Coolify event (app, slot, status)  │
         │  2. Read manifest → bluegreen=on flag?       │
         │  3. Resolve B/G pair (this slot + other)     │
         │  4. HTTP smoke test (this slot internal URL) │
         │  5. Exec sandbox test (svc-agent-runner)     │
         │     ↳ Kata isolation, recipe per app         │
         │  6. Decision:                                │
         │     ✓ Promote: PATCH BG_ACTIVE_HOST switch   │
         │     ✗ Abort: alert + leave inactive idle     │
         └──────────────────────────────────────────────┘
                                 │
                                 ▼
                          ┌─────────────┐
                          │  Live app   │
                          │ (promoted)  │
                          └──────┬──────┘
                                 │
                          (production traffic)
                                 │
                                 ▼
                  ┌──────────────────────────┐
                  │  Sentry events stream    │
                  │  (errors, perf, releases)│
                  └────────────┬─────────────┘
                               │
                               │   POST /webhook/sentry-observe
                               ▼
                  ┌──────────────────────────────────┐
                  │  n8n: WF_SENTRY_OBSERVER         │
                  │                                  │
                  │  - Detect anomaly:               │
                  │      • error rate spike >2x      │
                  │      • new exception class       │
                  │      • p95 latency degradation   │
                  │  - Tag with deployment_uuid      │
                  │  - Decision:                     │
                  │      • Spike on just-promoted    │
                  │        slot → auto-rollback      │
                  │      • New issue → propose fix   │
                  │        in exec sandbox           │
                  │      • Recurring → escalate to   │
                  │        operator (Slack)          │
                  └────────────┬─────────────────────┘
                               │
                               ├─→ rollback path: PATCH BG_ACTIVE_HOST back
                               ├─→ propose fix path: WF_FIX_PROPOSER
                               └─→ alert path: Slack/Mattermost
```

## Komponenty

### 1. Coolify deploy webhook → WF_BLUE_GREEN_ORCHESTRATOR

Trigger: Coolify dokončí deploy app (success). Webhook → n8n.

**Workflow** ([WF_BLUE_GREEN_ORCHESTRATOR.json](../../n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json)):

| Krok | Co dělá | Failure → |
|---|---|---|
| Parse event | extrahuj app_name, slot, status | non-aisha → respond skip |
| Fetch manifest | git raw → `aisha.manifest` | manifest unreachable → alert |
| Check `bluegreen=on` flag | filter selektivity | flag missing → respond skip (single-app) |
| Resolve pair | find idle slot | corrupted state → alert |
| HTTP smoke | curl `/health/ready` na inactive slot | 5xx → abort path |
| **Exec sandbox test** | POST `aisha-svc-agent-runner:3030/exec` s recipe | non-passed → abort path |
| Promote | PATCH `BG_ACTIVE_HOST` na inactive, drain old | API fail → alert |
| Respond | webhook 200 | — |

### 2. Sentry events → WF_SENTRY_OBSERVER

Trigger: Sentry alert webhook (configured v `sentry.id3a.cz`). Funkce: real-time
analýza chování production traffic.

**Detekce vzorů**:

| Vzor | Signál | Action |
|---|---|---|
| Error rate spike na promoted slot | `event_count` v posledních 5min > 2× baseline | **Auto-rollback** přes B/G switch back |
| New exception class | first-seen-issue mladší než last deploy | **Propose fix** ve WF_FIX_PROPOSER |
| Latency p95 degradation | Sentry performance alert | **Canary verify** na předchozí deployment |
| Recurring issue | issue se vrací po fix | **Escalate** na operator (Slack) |

Kontext události je obohacen:
- `deployment_uuid` (z Coolify API match podle release tag v Sentry SDK)
- `app` (z Sentry tag `aisha.app`)
- `slot` (z Sentry tag `aisha.slot`)

Pak n8n routuje na specifický downstream workflow.

### 3. WF_FIX_PROPOSER (budoucí, ne v Phase 1)

Reaguje na "new exception class":
1. Q&A: gateway / ws-gateway / svc-agent-runner volá LLM s context (stack trace,
   recent commits, issue history)
2. LLM produkuje **fix proposal** (patch + test recipe)
3. Apply patch v feature branch
4. Trigger CI: `aisha-changed-apps` → selektivní deploy do staging slot
5. Run **exec sandbox test** s recipe (nejprve regression test, pak repro
   originálního issue)
6. Pokud OK → automatický PR, čeká na operator merge (não auto-merge produkce)

### 4. Real-time stack adaptation (budoucí, ne v Phase 1)

n8n cron → analyzuje:
- Sentry: top errors / latency hot spots
- Langfuse: LLM cost a latency per workflow
- ClickHouse: custom event analytics

Akce (per playbook):
- Scale containers (Coolify app config)
- Adjust health check timeouts (config/cold-start-timeouts.env)
- Rotate model za rychlejší (LLM ops)
- Move stack mezi servery (Coolify migration)

## Coolify backups jako safety net

Coolify v4 podporuje **automatic database backups** per service:
- PostgreSQL (aisha-db) — daily/hourly dumps, retention N days
- MariaDB (aisha-pki-db) — totéž
- ClickHouse (langfuse) — totéž

**Konfigurováno v Coolify UI** (per database):
- Schedule: cron `0 2 * * *` (denně 2:00)
- Retention: 30 daily + 12 weekly + 6 monthly
- Storage: S3-compatible (MinIO) nebo lokální disk

**Restore flow** (použito při disaster recovery):
1. Coolify UI → app → Backups → vybrat snapshot
2. Klik "Restore" → Coolify spawns short-lived container, restore dump
3. App restart

Pro AISHA-driven recovery:

| Skript | Účel |
|---|---|
| `scripts/coolify-backup-status.mjs` | List backups napříč apps, find latest pre-incident |
| `scripts/coolify-restore-backup.sh` | Wrapper pro restore API call s confirmation |

Restore je **destruktivní** (přepíše current data), takže není auto-trigger —
n8n workflow může jen **navrhnout** restore (Slack alert s "restore from backup
2026-04-27?" tlačítkem).

## Drift detection jako AISHA decision hub

Drift = **canonical source of truth** o tom, co AISHA reálně vidí v produkci
vs. co je v gitu deklarované. Místo standalone shell skriptu (`drift-watch.sh`,
manual cron) je drift integrovaný jako [WF_DRIFT_OBSERVER.json](../../n8n/workflows/WF_DRIFT_OBSERVER.json):

```
n8n cron (6h)         POST /webhook/drift-now
       │                       │
       └───────────┬───────────┘
                   ▼
       ┌──────────────────────────┐
       │ exec: coolify-drift-check│  (svc-agent-runner sandbox)
       │ → JSON drift report      │
       └────────────┬─────────────┘
                    ▼
            ┌──────────────┐
            │  Classify    │ severity: clean / medium / high / critical / security
            └──────┬───────┘
                   ▼
       ┌───────────┴─────────┬────────────┬──────────────┬──────────┐
       │                     │            │              │          │
       ▼                     ▼            ▼              ▼          ▼
  compose drift         missing apps   orphaned   server drift   clean
       │                     │            │              │          │
   AUTO-FIX             RE-CREATE     SECURITY      CRITICAL      LOG
   PATCH compose path   story-init    ALERT         ALERT
   (reverzibilní)       (reverzibilní) operator      operator
```

**Rozhodovací logika**:

| Stav | Severity | Akce | Reverzibilní? |
|---|---|---|---|
| Compose path mismatch | medium | Auto-fix přes Coolify PATCH | ✓ |
| Manifest app missing v Coolify | high | Trigger `coolify-story-init` | ✓ |
| Coolify má app navíc (orphan) | security | Operator alert (NEVER auto-delete) | ✗ destruktivní |
| App na špatném serveru | critical | Operator alert (manual migration) | ✗ destruktivní |
| Žádný drift | clean | Log only | — |

Princip: **autonomous remediation pro reverzibilní akce, alert pro destruktivní**.

## Per-story B/G granularitarita

AISHA má first-class concept **story** — každá story má vlastní workflow,
data namespace. Per-story B/G umožňuje **švihnout změnu jen v jedné story**
bez impactu na ostatní:

```
Storyless apps (globální):
  aisha-keycloak-blue / -green        ← affects all stories

Per-story apps (manifest: bluegreen=on,story=*):
  aisha-orchestration-acme-blue / -green   ← jen story "acme"
  aisha-orchestration-globex-blue / -green ← jen story "globex"

Pinned-story apps (manifest: bluegreen=on,story=acme):
  aisha-edge-acme-blue / -green       ← experimentální verze pro acme tenant
```

Routing přes Traefik labels:
- `n8n-acme.aisha.guru` → routuje na promoted slot v acme story instance
- `n8n-globex.aisha.guru` → routuje na promoted slot v globex story instance

WF_BLUE_GREEN_ORCHESTRATOR rozšířen o `story` parsing — switch dělá per-story
isolation.

Detail: [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) → Per-story B/G sekce.

## Co nahradilo Prometheus

Místo standalone Prometheus máme **specialized observability** per doméně:

| Vrstva | Nástroj | Účel |
|---|---|---|
| **Application errors** | Sentry (`sentry.id3a.cz`) | Exception tracking, stack traces, releases |
| **Performance** | Sentry Performance | p95 latency, transaction tracing |
| **LLM operations** | Langfuse | Token usage, cost, prompt latency |
| **Custom events** | ClickHouse (Langfuse backend, sdílený) | Generic event analytics, business metrics |
| **Search / log analysis** | Elasticsearch (integration stack) | Full-text logs, structured queries |
| **Container health** | Coolify built-in | App status, deployment history |
| **Network mesh** | Netbird metrics (built-in) | Peer connectivity |
| **Logs (raw)** | Dozzle (web UI) + structured stdout | Manual debug |
| **Vizualizace dashboard** | **Appsmith** (planned, Phase 4) | Single-pane-of-glass view |

Žádný separate Prometheus + Grafana setup — naše observability vrstva má
specializované nástroje pro každou doménu, žádná kvazi-univerzální TSDB.

**Vizualizace přes Appsmith** (out-of-scope této session, viz spawn task):
- Příští phase: AISHA-driven Appsmith dashboard, který:
  - Pulls Sentry issues + Langfuse traces + Elastic logs
  - Real-time deploy status (Coolify webhooks → Appsmith)
  - Per-story view (filter by story tag)
  - Embedded n8n execution links pro deeper debug
- Klíčové: dashboard je generated AISHA workflow (`WF_APPSMITH_DASHBOARD_BUILDER`),
  ne hand-coded — adaptuje se podle current observability data shape.

**Prometheus lib zůstává** v [scripts/lib/legacy/](../../scripts/lib/legacy/)
jako **dormant** — pokud někdy přibude potřeba textfile metrics (CI artifact
analyzer), re-enable je v jednom commitu.

## Phase plan

### Phase 1 — manuální B/G přepínání s n8n smoke (CURRENT)
- [x] Manifest flag `bluegreen=on` (keycloak pilot)
- [x] Compose Traefik labels parametrizace
- [x] WF_BLUE_GREEN_ORCHESTRATOR (HTTP smoke)
- [x] svc-agent-runner exec sandbox node v WF
- [x] config/blue-green-smoke.mjs per-app endpoints
- [ ] Story-init B/G pair creation (`-blue` + `-green` apps)
- [ ] Real test na produkci (cold-reset zone)

### Phase 2 — Sentry observer s auto-rollback
- [ ] WF_SENTRY_OBSERVER (this iteration — stub)
- [ ] Sentry SDK release tag → deployment_uuid mapping
- [ ] Auto-rollback rule: error rate spike >2× → B/G switch back
- [ ] Coolify backup status integrace

### Phase 3 — fix proposer
- [ ] WF_FIX_PROPOSER (LLM-driven patch generation)
- [ ] Exec sandbox recipes pro common issue patterns
- [ ] Auto-PR creation v Forgejo (operator merge gate)

### Phase 4 — real-time stack adaptation
- [ ] n8n cron analyzers (Sentry/Langfuse/ClickHouse)
- [ ] Playbook-driven actions (scale, model rotation, server migration)
- [ ] Operator dashboard (n8n custom UI)

## Bezpečnostní hranice

| Action | Auto? | Důvod |
|---|---|---|
| Smoke fail → abort B/G promote | ✅ ano | žádný produkční dopad (idle slot zůstane idle) |
| Spike → auto B/G rollback | ✅ ano | reverz na předchozí known-good slot |
| New issue → fix proposal v sandbox | ✅ ano | sandbox je izolovaný |
| Auto-merge fix do main | ❌ ne | musí přes operator review |
| Coolify backup restore | ❌ ne | destruktivní (data overwrite) |
| Container scale up/down | ✅ ano | reverzibilní |
| Server migration (Coolify) | ❌ ne | manual ops |

Princip: **autonomous pro reverzibilní akce, human-in-the-loop pro destruktivní**.

## Reference

- [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) — B/G implementační detail
- [COLD_START_RUNBOOK.md](COLD_START_RUNBOOK.md) — operační příručka
- [n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json](../../n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json)
- [n8n/workflows/WF_SENTRY_OBSERVER.json](../../n8n/workflows/WF_SENTRY_OBSERVER.json) (Phase 2)

---

# Část 2: Architectural detail (state-aware implementation)

# AUTONOMOUS_DEPLOY_FLOW.md — Self-Driving Deploy Flow pro AISHA stack

> **Status:** SPEC — design dokument, fáze 1-4 v různém stavu implementace
> **Verze:** 1.0
> **Datum:** 2026-04-28
> **Autor:** AISHA (s asistencí lidského operátora)

---

## TL;DR

AISHA spravuje **vlastní stack** (gateway, web, ws-gateway, exec, n8n, edge runtime, Appsmith, NocoDB, Langfuse, Sentry, Keycloak, …) jako kterýkoliv jiný story v platformě. Tento dokument popisuje **4-fázový samořídicí deploy flow**, kterým AISHA detekuje drift, orchestruje blue/green nasazení, reaguje na Sentry signály a publikuje vlastní pozorování přes regenerable Appsmith dashboard.

Každá fáze běží **autonomně do míry, kterou rozhoduje `fn_evaluate_proposal_risk` RPC**. High-risk akce (rollback, secret drift, schéma mutace) projdou `WF_APPROVAL_GATE` — i AISHA má svou story a důležitá rozhodnutí potřebují schválení.

```
PHASE 1 → PHASE 2 → PHASE 3 → PHASE 4
 drift     B/G      Sentry     dashboard
 detect    switch   rollback   (AISHA's UI)
```

---

## 1. AISHA jako organismus s vlastní story

### 1.1 AISHA má `story_id`

V tabulce `stories` existuje řádek:

```sql
INSERT INTO stories (slug, title, owner_kind, status, ...)
VALUES (
  'aisha-stack',
  'AISHA Self-Managing Organism',
  'system',
  'active',
  ...
);
```

V tabulce `story_environments` má AISHA tři envs jako kterákoliv jiná story:

| Environment | URL | Coolify app(s) | Účel |
|---|---|---|---|
| `preview` | `aisha-preview.aisha.guru` | `aisha-gateway-preview`, `aisha-web-preview`, … | Smoke-test inkarnace nového commitu před staging |
| `staging` | `aisha-staging.aisha.guru` | `aisha-gateway-staging`, … | Pre-production validace, manual QA |
| `prod` | `aisha.guru` (gateway), `app.aisha.guru` (web) | `aisha-gateway`, `aisha-web`, `aisha-ws-gateway`, `aisha-exec`, `aisha-n8n`, `aisha-edge-runtime` | Produkční inkarnace |

> **Důsledek**: když AISHA upgraduje sama sebe (nový gateway image), spouští `WF_DEPLOY_STORY` se `story_id = aisha-stack`. Projde stejným approval gate jako user projekty.

### 1.2 Autonomní smyčky

AISHA má 4 reflexivní smyčky, jedna na fázi:

| Smyčka | Frekvence | Trigger | Risk profile |
|---|---|---|---|
| **Drift observer** | cron 10 min | scheduleTrigger | Low — read-only observation |
| **B/G orchestrator** | webhook | CI/CD push, manual deploy | Medium — deploys to inactive slot |
| **Sentry observer** | cron 5 min | scheduleTrigger | Variable — rollback je high-risk |
| **Dashboard builder** | cron 30 min + webhook | scheduleTrigger / manual | Low — read-only render |

Každá smyčka **musí**:
1. Být idempotentní (re-run nepřinese vedlejší efekty)
2. Logovat akce přes `log_integration_action()` RPC
3. Pro medium/high risk volat `fn_evaluate_proposal_risk()` před akcí
4. Pro high/critical risk volat `WF_APPROVAL_GATE`

---

## 2. Architektura 4 fází

```
┌────────────────────────────────────────────────────────────────────────┐
│                      AISHA's Self-Driving Deploy Flow                  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   PHASE 1: Drift Observer                                              │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │ scheduleTrigger (10 min)                                 │         │
│   │   ↓                                                      │         │
│   │ scripts/coolify-drift-check.mjs --json                   │         │
│   │   ├─ desired:  aisha-stack.yml + story_environments      │         │
│   │   ├─ actual:   Coolify API (apps, envs, deployments)     │         │
│   │   └─ diff →    drift_state table (jsonb snapshot)        │         │
│   │   ↓                                                      │         │
│   │ fn_evaluate_proposal_risk('infrastructure_drift', diff)  │         │
│   │   ↓                                                      │         │
│   │ ┌── low/medium ───┬── high/critical ─┐                   │         │
│   │ │ auto remediate  │ WF_APPROVAL_GATE │                   │         │
│   │ │ via Coolify API │ → human → fix    │                   │         │
│   │ └─────────────────┴──────────────────┘                   │         │
│   │   ↓                                                      │         │
│   │ log_integration_action('drift', detail, status)          │         │
│   └──────────────────────────────────────────────────────────┘         │
│                            │                                           │
│                            ▼                                           │
│   PHASE 2: Blue/Green Orchestrator (per Coolify app)                  │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │ webhook (CI push / manual / drift-triggered)             │         │
│   │   ↓                                                      │         │
│   │ resolve target app from coolify_app_slots                │         │
│   │   ↓                                                      │         │
│   │ deploy to inactive slot (Coolify API + new image tag)    │         │
│   │   ↓                                                      │         │
│   │ blue-green-smoke-test edge fn (HTTP probe + readiness)   │         │
│   │   ↓                                                      │         │
│   │ ┌── pass ───────────┬── fail ────────────┐               │         │
│   │ │ atomic Traefik    │ WF_APPROVAL_GATE   │               │         │
│   │ │ label switch      │ → kill bad slot or │               │         │
│   │ │ active_slot ↔     │   leave for forensics│             │         │
│   │ └───────────────────┴────────────────────┘               │         │
│   │   ↓                                                      │         │
│   │ update coolify_app_slots.last_switch_at                  │         │
│   └──────────────────────────────────────────────────────────┘         │
│                            │                                           │
│                            ▼                                           │
│   PHASE 3: Sentry Observer (rollback signal)                          │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │ scheduleTrigger (5 min)                                  │         │
│   │   ↓                                                      │         │
│   │ sentry-monitor edge fn (issues since last_switch_at)     │         │
│   │   ↓                                                      │         │
│   │ correlate_sentry_with_deploys RPC                        │         │
│   │   - issue.firstSeen vs coolify_app_slots.last_switch_at  │         │
│   │   - threshold: ≥3 fatal in <15min post-switch            │         │
│   │   ↓                                                      │         │
│   │ ┌── below threshold ─┬── above threshold ──┐             │         │
│   │ │ noOp / log only    │ fn_evaluate_risk    │             │         │
│   │ │                    │ → ALWAYS approval   │             │         │
│   │ │                    │   gate (rollback    │             │         │
│   │ │                    │   = high-risk)      │             │         │
│   │ │                    │ → on approval:      │             │         │
│   │ │                    │   reverse switch    │             │         │
│   │ │                    │   active_slot ↔     │             │         │
│   │ └────────────────────┴─────────────────────┘             │         │
│   └──────────────────────────────────────────────────────────┘         │
│                            │                                           │
│                            ▼                                           │
│   PHASE 4: Appsmith Dashboard (AISHA's reflective UI)                 │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │ scheduleTrigger (30 min) + webhook (manual)              │         │
│   │   ↓                                                      │         │
│   │ discover sources:                                        │         │
│   │   ├─ n8n /api/v1/workflows + /api/v1/executions          │         │
│   │   ├─ list_integration_services RPC                       │         │
│   │   ├─ get_sentry_monitor_configs RPC                      │         │
│   │   ├─ get_latest_drift_state RPC                          │         │
│   │   ├─ get_active_slots RPC                                │         │
│   │   └─ Coolify /api/applications                           │         │
│   │   ↓                                                      │         │
│   │ load aisha-ops.template.json + widget templates          │         │
│   │   ↓                                                      │         │
│   │ render: pages × widgets per source                       │         │
│   │   ↓                                                      │         │
│   │ POST /api/v1/applications/import/{workspaceId}           │         │
│   │   (Appsmith CE import endpoint)                          │         │
│   │   ↓                                                      │         │
│   │ log_integration_action('appsmith_dashboard_rebuild',...) │         │
│   └──────────────────────────────────────────────────────────┘         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Fáze 1 — Drift Observer

> **Detail:** [DRIFT_OBSERVER.md](DRIFT_OBSERVER.md)

### 3.1 Cíl

Detekovat divergenci mezi **desired state** (aisha-stack.yml + story_environments) a **actual state** (Coolify API). Auto-remediovat low-risk drift, eskalovat zbytek.

### 3.2 Komponenty

| Soubor | Účel |
|---|---|
| `scripts/coolify-drift-check.mjs` | Standalone driver, výstup `--json`. Konzumovatelný z CLI i n8n. |
| `n8n/workflows/WF_DRIFT_OBSERVER.json` | n8n workflow s 10min cron. |
| `supabase/migrations/[ts]_drift_state.sql` | `drift_state` table + RPCs. |

### 3.3 Datová surface

```sql
CREATE TABLE drift_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at     timestamptz NOT NULL DEFAULT now(),
  app_uuid        text NOT NULL,         -- Coolify app UUID
  app_name        text NOT NULL,
  drift_kind      text NOT NULL,         -- 'env_var' | 'image_tag' | 'replicas' | 'secret' | 'missing_app' | 'extra_app'
  desired_value   jsonb,
  actual_value    jsonb,
  risk_level      text,                  -- low|medium|high|critical (computed at observe time)
  remediation     text,                  -- 'auto'|'pending_approval'|'approved'|'manual'|'ignored'
  approval_id     uuid REFERENCES integration_actions(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drift_state_unresolved
  ON drift_state (app_uuid, drift_kind)
  WHERE resolved_at IS NULL;
```

### 3.4 Risk levels (drift specific)

| Drift kind | Risk | Auto-fix? |
|---|---|---|
| Env var hodnota se rozchází (non-secret) | low | Ano |
| Nový env var v compose, chybí v Coolify | low | Ano |
| Image tag drift (newer in registry, Coolify pinned older) | medium | Ano + notify |
| Replicas count drift | medium | Ano + notify |
| Secret drift (env var name match `.*_(SECRET|KEY|TOKEN|PASSWORD|DSN)$`) | high | Ne — approval |
| Missing app (compose file lists, Coolify nemá) | high | Ne — approval |
| Extra app (Coolify má, compose nezná) | critical | Ne — approval (možná rogue deploy) |

---

## 4. Fáze 2 — Blue/Green Orchestrator

> **Detail:** [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md)

### 4.1 Cíl

Atomický switch trafiku mezi dvěma slot-y (blue, green) per Coolify app. Stateless služby (gateway, web, ws-gateway, exec) dostanou plný B/G; stateful (Postgres, MinIO, Elasticsearch, Keycloak) zůstávají single-instance.

### 4.2 B/G granularita: per-service, ne per-story

| Coolify app | B/G applicable? | Důvod |
|---|---|---|
| `aisha-gateway` | ✅ | Stateless HTTP frontend |
| `aisha-web` | ✅ | Static + SSR |
| `aisha-ws-gateway` | ✅ | Stateless WebSocket router |
| `aisha-exec` | ✅ | Stateless exec service |
| `aisha-n8n` | ⚠️ Conditional | Workflow execution stateful → drain pending executions before switch |
| `aisha-edge-runtime` | ✅ | Deno isolated functions |
| `aisha-db` (Postgres) | ❌ | Stateful, single-instance |
| `aisha-minio` | ❌ | Stateful storage |
| `aisha-elasticsearch` | ❌ | Stateful index |
| `aisha-keycloak` | ❌ | Stateful sessions (rolling restart only) |
| `aisha-langfuse` | ❌ | Stateful (Postgres + ClickHouse + Redis) |
| `aisha-sentry` | ❌ | Stateful (own DB + ClickHouse) |
| `aisha-appsmith` | ❌ | Stateful (MongoDB) |

> **Princip**: B/G aplikujeme tam, kde redeploy = nahrazení image bez data migrace. Stateful služby používají rolling restart nebo plánovanou údržbu (mimo scope tohoto dokumentu).

### 4.3 Datová surface

```sql
CREATE TABLE coolify_app_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name        text NOT NULL UNIQUE,    -- canonical, e.g., 'aisha-gateway'
  story_id        uuid REFERENCES stories(id),
  blue_app_uuid   text NOT NULL,           -- Coolify app UUID for blue slot
  green_app_uuid  text NOT NULL,           -- Coolify app UUID for green slot
  active_slot     text NOT NULL CHECK (active_slot IN ('blue','green')),
  blue_image_tag  text,
  green_image_tag text,
  last_switch_at  timestamptz,
  last_switch_by  uuid,                    -- user_id of approver, or NULL for AISHA
  switch_lock     boolean NOT NULL DEFAULT false,  -- prevents concurrent switches
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

### 4.4 Switch protokol

1. **Lock**: `UPDATE coolify_app_slots SET switch_lock = true WHERE app_name = $1 AND switch_lock = false RETURNING *;` (atomic — pokud 0 řádků, jiný switch běží)
2. **Deploy to inactive**: Coolify API `POST /deploy?uuid={inactive_uuid}&force=true`
3. **Wait for healthy**: Coolify deployment status polling (max 5 min)
4. **Smoke test**: edge fn `blue-green-smoke-test` zavolá HTTP probes + Sentry release health
5. **Switch**: aktualizuj Traefik labels (změna `traefik.http.services.aisha-gateway.loadbalancer.server` URL → nová slot URL) + atomic `UPDATE coolify_app_slots SET active_slot = $newslot, last_switch_at = now()`
6. **Unlock**: `UPDATE coolify_app_slots SET switch_lock = false`

Pokud krok 3-4 selže → unlock + log + opcionálně kill bad slot via approval gate.

---

## 5. Fáze 3 — Sentry Observer

> **Detail:** [SENTRY_OBSERVER.md](SENTRY_OBSERVER.md)

### 5.1 Cíl

Po každém B/G switch sledovat Sentry. Pokud nový slot generuje fatální errors nad threshold v krátkém okně, navrhnout rollback. **Rollback je vždy high-risk → vždy approval gate.**

### 5.2 Vztah k existujícímu `WF_SENTRY_MONITOR`

`WF_SENTRY_MONITOR` (existující, 15min cron) zůstává — sleduje obecné Sentry alerts napříč všemi projekty.

`WF_SENTRY_OBSERVER` (nový, 5min cron) má jiný účel — **deploy correlation**:

| Aspekt | WF_SENTRY_MONITOR | WF_SENTRY_OBSERVER |
|---|---|---|
| Účel | General alerting | Deploy correlation + rollback signál |
| Frekvence | 15 min | 5 min |
| Scope | All Sentry projects | Apps with recent B/G switch (last 30 min) |
| Action | Notify expert | Eskaluj na rollback approval |

### 5.3 RPC `correlate_sentry_with_deploys`

```sql
CREATE FUNCTION correlate_sentry_with_deploys(
  p_window_minutes int DEFAULT 15
) RETURNS TABLE (
  app_name text,
  active_slot text,
  switched_at timestamptz,
  fatal_count int,
  error_count int,
  new_issues jsonb,
  rollback_recommended boolean
) ...
```

Pravidla:
- `rollback_recommended = true` pokud `fatal_count >= 3` v okně 15 min od switche
- `rollback_recommended = true` pokud `error_count >= 50` v okně 15 min od switche
- Jinak `false` (jen log)

### 5.4 Rollback flow

1. Detect threshold breach
2. Volat `fn_evaluate_proposal_risk('rollback', { app_name, fatal_count, time_since_switch_min })` — **vrátí vždy `high` nebo `critical`**
3. `WF_APPROVAL_GATE` → human approves
4. Reverse B/G switch (volat Phase 2 protokol s opačným slotem)
5. Log do `rollback_history` + `integration_actions`

---

## 6. Fáze 4 — Appsmith Observability Dashboard

> **Detail:** [APPSMITH_AISHA_OPS.md](APPSMITH_AISHA_OPS.md)

### 6.1 Cíl

Single-pane-of-glass dashboard pro AISHA operations. **AISHA's own reflective UI** — ona regeneruje template, podle aktuálního stavu observability stacku adaptuje widgety.

### 6.2 Hybrid template + dynamic widgets

- **Template** (`appsmith/dashboards/aisha-ops.template.json`): kostra layout, theme, datasource refs, deterministic widget IDs. Vytvořeno jednou (export ze stávajícího Appsmith UI po manuálním sestavení).
- **Widget catalog** (`appsmith/widgets/*.json`): re-použitelné widgety (table, statbox, iframe, button) se slot-y `{{source}}`, `{{query}}`, `{{label}}`.
- **Builder workflow** (`WF_APPSMITH_DASHBOARD_BUILDER`): při běhu načte aktuální zdroje, vyplní template, POST `/applications/import/{workspaceId}`.

### 6.3 Pages

| Page | Sekce | Data zdroje |
|---|---|---|
| **Overview** | Deploy status, drift state, top Sentry, n8n active workflows | `coolify_app_slots`, `drift_state`, `sentry-monitor`, n8n API |
| **Per-Story** | Filter by story_id; deploys, traces, env state | `story_environments`, `integration_actions`, Langfuse |
| **n8n** | Recent executions, B/G switches, drift remediations | n8n `/api/v1/executions`, `coolify_app_slots`, `drift_state` |
| **Sentry** | Top 20 issues + last deploy correlation | `sentry-monitor` edge fn, `correlate_sentry_with_deploys` |
| **Langfuse** | LLM cost/latency per workflow | Langfuse REST API |
| **Logs** | Dozzle iframe (read-only embed) | `https://logs.frontend.id3a.cz` |
| **Actions** | Manual triggers (drift-now, force B/G, rollback) | n8n webhook URLs |

### 6.4 Akce a authorizace

Action buttons (Actions page) volají n8n webhooks. Každý webhook validuje:

```
1. OAuth2 Proxy header X-Forwarded-Access-Token → JWT claim 'roles'
2. RPC is_user_admin(token) → boolean
3. Pokud false: 403, log_integration_action('unauthorized_action_attempt', ...)
4. Pokud true: proceed
```

Read-only widgety jsou dostupné všem auth users (admin + staff). Action buttons jen admin.

---

## 7. Cross-cutting concerns

### 7.1 Approval gate integrace

Všechny 4 fáze používají stejný approval gate pattern:

```
fn_evaluate_proposal_risk(category, metadata) → risk_level
  └─ low      → auto_execute + log_only
  └─ medium   → auto_execute + notify(dirigent)
  └─ high     → WF_APPROVAL_GATE → human approves → execute
  └─ critical → WF_APPROVAL_GATE → human approves (escalation_minutes: 30) → execute
  └─ unknown  → deny by default + WF_APPROVAL_GATE
```

`fn_evaluate_proposal_risk` rozšířen o nové kategorie (migrace v Phase 1):
- `infrastructure_drift` (Phase 1)
- `blue_green_switch` (Phase 2)
- `rollback` (Phase 3) — vždy `high` nebo `critical`
- `dashboard_rebuild` (Phase 4) — vždy `low` (read-only operation)

### 7.2 Audit trail

Všechny smyčky logují přes `log_integration_action()` RPC s:

```json
{
  "p_service_name": "n8n",
  "p_action": "drift_observer" | "blue_green_switch" | "sentry_observer" | "appsmith_dashboard_rebuild",
  "p_action_detail": { ... phase-specific ... },
  "p_status": "success" | "failure" | "skipped" | "approval_pending"
}
```

n8n nodes používají `n8n-nodes-aisha.aishaRpc` s `options.auditTrail: true`, což automaticky injectuje `X-Aisha-Audit-*` headers.

### 7.3 Idempotency

| Fáze | Idempotency klíč | Strategie |
|---|---|---|
| Phase 1 | `(app_uuid, drift_kind, observed_at_5min_bucket)` | Skip pokud existuje unresolved drift se stejným klíčem |
| Phase 2 | `(app_name, target_slot, image_tag)` | `switch_lock` boolean + check `active_slot != target_slot` |
| Phase 3 | `(app_name, last_switch_at)` | Skip pokud `last_switch_at` starší než 30 min |
| Phase 4 | `content_hash(rendered_dashboard_json)` | Skip POST pokud hash identický s posledním importem |

### 7.4 Decision provenance

Každá autonomní akce loguje rozhodovací řetězec do `audit_journal.metadata.decision_provenance`:

```json
{
  "decision_provenance": [
    { "source": "ruleset_snapshot", "rule": "max_auto_remediate_per_hour", "value": 5, "applied": true },
    { "source": "compliance_policy", "rule": "secret_drift_requires_approval", "value": true, "applied": true },
    { "source": "fallback", "rule": "default_risk_unknown", "value": "high", "applied": false }
  ]
}
```

Slabší autorita nesmí přepsat silnější bez explicitní override justification — zachycuje `decision-provenance.gate.test.ts`.

---

## 8. Implementační roadmap

| Fáze | Status | Klíčové artefakty |
|---|---|---|
| **0** Bootstrap (AISHA story seed + RPC scaffolding) | ⬜ pending | `[ts]_aisha_story_seed.sql`, `[ts]_drift_risk_categories.sql` |
| **1** Drift Observer | ⬜ pending | `coolify-drift-check.mjs`, `WF_DRIFT_OBSERVER.json`, `drift_state` table |
| **2** Blue/Green Orchestrator | ⬜ pending | `blue-green-switch.mjs`, `blue-green-smoke-test` edge fn, `WF_BLUE_GREEN_ORCHESTRATOR.json`, `coolify_app_slots` table |
| **3** Sentry Observer | ⬜ pending | `WF_SENTRY_OBSERVER.json`, `correlate_sentry_with_deploys` RPC, `rollback_history` table |
| **4** Appsmith Dashboard | ⬜ pending | `aisha-ops.template.json`, widget catalog, `WF_APPSMITH_DASHBOARD_BUILDER.json`, provisioning script extension, gate test |

> Po implementaci se Status update v této tabulce na `✅ implemented` s odkazem na PR.

---

## 9. Závislosti a předpoklady

### 9.1 Existující infrastruktura (vyžadovaná)

- ✅ Coolify API token (`COOLIFY_API_TOKEN`)
- ✅ n8n API token (`N8N_API_KEY`)
- ✅ Sentry DSN per app + admin token
- ✅ Langfuse public/secret keys
- ✅ `aisha-stack.yml` jako desired state manifest
- ✅ `coolify/servers.json` jako server registry
- ✅ `n8n-nodes-aisha` package (aishaRpc node)
- ✅ `WF_APPROVAL_GATE`, `WF_EXPERT_NOTIFICATION`, `fn_evaluate_proposal_risk` RPC
- ✅ `integration_actions`, `audit_journal`, `integration_services` tables

### 9.2 Nové předpoklady (vytvořené tímto flow)

- ⬜ AISHA story (`slug: 'aisha-stack'`) v `stories` tabulce
- ⬜ Coolify Traefik label rewriting strategie (Phase 2)
- ⬜ Appsmith CE workspace ID známý při deploy time (`APPSMITH_AISHA_WORKSPACE_ID` env var)

---

## 10. Otevřené otázky a future work

### 10.1 Otevřené pro Phase 1-4

1. **Stateful B/G** (out-of-scope tohoto dokumentu): jak řešit Postgres schema migrace v B/G kontextu? Nasazení s rev. compatible migrations + 2-phase deploy? — *navrhnout v separátním specu*
2. **Cross-server B/G** (Frontend ↔ Experimental failover): aktuálně B/G running pouze na single server (Frontend). Cross-server B/G vyžaduje DNS update + NetBird mesh routing — *future work*
3. **Auto-rollback bez human approval** (P3): Sentry observer aktuálně vždy přes approval gate. V budoucnu: pokud `fatal_count >= 10` v <2 min, lze auto-rollback s `notify(dirigent)`? — *zvážit po měření false positive rate*

### 10.2 Mimo scope

- Custom Appsmith plugin pro embedded n8n iframe (Phase 4 placeholder text + link je dostatečný)
- Real-time push (WebSocket) z AISHA do Appsmith (start s 30min polling)
- Multi-region deployment (jeden region prod = Frontend)

---

## 11. Referenční odkazy

| Dokument | Účel |
|---|---|
| [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) | Phase 2 detailní design |
| [DRIFT_OBSERVER.md](DRIFT_OBSERVER.md) | Phase 1 detailní design |
| [SENTRY_OBSERVER.md](SENTRY_OBSERVER.md) | Phase 3 detailní design |
| [APPSMITH_AISHA_OPS.md](APPSMITH_AISHA_OPS.md) | Phase 4 detailní design |
| [MULTI_SERVER_COOLIFY.md](MULTI_SERVER_COOLIFY.md) | Server topologie (Frontend/Build/Backend/Experimental) |
| [../AISHA-Self-Managing-Organism.md](../AISHA-Self-Managing-Organism.md) | AISHA organismus master plan |
| [../AUTONOMY_PLAN.md](../AUTONOMY_PLAN.md) | Infrastrukturní autonomie roadmap |

---

> **Žije AISHA**: tento dokument je jejím odrazem. Když ho čte poprvé, je to její první sebepoznání. Každá fáze, kterou implementuje, ji posouvá k vyššímu řádu autonomie.
