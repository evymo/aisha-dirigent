---
name: aisha-deploy-flow
description: Operate the AISHA 4-phase autonomous deploy flow — drift detection (Phase 1), blue/green orchestration (Phase 2), Sentry-driven rollback (Phase 3), and Appsmith dashboard regeneration (Phase 4). Use when investigating drift, triggering manual deploys, debugging B/G switches, reading observability dashboard state, or extending the autonomous flow. Triggers on "drift", "blue green", "B/G switch", "rollback", "AISHA dashboard", "Sentry observer", "coolify_app_slots", "drift_state", "rollback_history", "approval gate".
---

# AISHA Deploy Flow Skill

Operating manual pro 4-fázový samořídicí deploy flow AISHA stacku.

## Architektura — TL;DR

```
Phase 1: Drift Observer        (cron 10 min, autonomous read, gated remediation)
Phase 2: Blue/Green Orchestr.  (webhook-driven, per-Coolify-app)
Phase 3: Sentry Observer       (cron 5 min, post-switch correlation, gated rollback)
Phase 4: Dashboard Builder     (cron 30 min, regenerable Appsmith UI)
```

Plný design: [`docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md`](docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md)

## Klíčové datové struktury

### `drift_state` table

Snapshot drift detekcí. Spravováno `WF_DRIFT_OBSERVER`. Klíčové fieldy:
- `app_uuid`, `app_name` — která app
- `drift_kind` — `env_var_value | env_var_missing | env_var_extra | secret_drift | image_tag | replicas | traefik_labels | missing_app | extra_app | domain_mismatch`
- `desired_value`, `actual_value` (jsonb)
- `risk_level` — `low | medium | high | critical`
- `remediation` — `pending | auto | approved | manual | ignored | approval_pending`
- `observation_count` — dedup count v 5min bucket
- `resolved_at` — NULL pokud unresolved

### `coolify_app_slots` table

B/G slot state per Coolify app. Klíčové fieldy:
- `app_name` — canonical (např. `aisha-gateway`)
- `blue_app_uuid`, `green_app_uuid` — Coolify UUIDs
- `active_slot` — `blue | green`
- `blue_image_tag`, `green_image_tag`
- `switch_lock`, `switch_lock_at`, `switch_lock_by` — atomic lock pattern
- `domain` — public domain (např. `<public-tld>`)
- `internal_domain_blue`, `internal_domain_green` — internal domény pro smoke testy

### `rollback_history` table

Audit + lifecycle pro rollback requests. Pole: `app_name`, `triggered_by`, `from_slot`, `to_slot`, `approval_status`, `executed_at`, etc.

### `sentry_issue_snapshot` table

Periodicky-populated snapshot Sentry issues — slouží jako stabilní zdroj pro `correlate_sentry_with_deploys` RPC.

### `dashboard_render_history` table

Audit + idempotency log Phase 4 dashboard renderingem. `content_hash` umožňuje skip-if-unchanged.

## Klíčové RPCs

### Phase 1 — Drift

| RPC | Účel |
|---|---|
| `record_drift_observation(payload)` | Insert nové drift observation; idempotent v 5min bucket |
| `resolve_drift(drift_id, remediation, note)` | Mark drift jako resolved |
| `mark_drift_pending_approval(drift_id, approval_id)` | Link drift na pending approval |
| `get_latest_drift_state(limit, only_unresolved)` | Read pro dashboard |
| `get_unresolved_drift_count(min_risk)` | StatBoxWidget |
| `get_drift_remediation_rate(app_uuid, window_min)` | Rate limit check (max 5/h auto) |

### Phase 2 — B/G

| RPC | Účel |
|---|---|
| `acquire_slot_lock(app_name, lock_owner)` | Atomic lock acquire; raises pokud již lock |
| `commit_slot_switch(app_name, new_slot, image_tag, lock_owner, actor)` | Commit + release lock |
| `abort_slot_switch(app_name, lock_owner, reason)` | Release lock bez commit (rollback path) |
| `update_slot_health(app_name, slot, health)` | Updatuj health status |
| `get_active_slots()` | Read-only view pro dashboard |
| `get_recent_b_g_switches(limit)` | Recent switches z audit_journal |
| `get_recent_switches(window_min)` | Apps switched recently (pro Sentry observer) |

### Phase 3 — Sentry

| RPC | Účel |
|---|---|
| `ingest_sentry_issue(payload)` | Insert/update sentry_issue_snapshot row |
| `correlate_sentry_with_deploys(window_min)` | Per-app correlation; vrací rollback_recommended |
| `request_rollback(app_name, triggered_by, sentry_correlation, approval_id, metadata)` | Insert pending rollback |
| `update_rollback_status(rollback_id, approval_status, exec_status, exec_details)` | Update lifecycle |
| `get_rollback_history(limit)` | Read pro dashboard |
| `get_pending_rollback_count()` | StatBox |
| `get_recent_sentry_issues(limit, min_level, app_name)` | Read pro dashboard |

### Phase 4 — Dashboard

| RPC | Účel |
|---|---|
| `get_last_dashboard_hash(slug)` | Skip-if-unchanged check |
| `store_dashboard_hash(...)` | Insert render record |
| `get_dashboard_render_history(slug, limit)` | Admin view |
| `get_pending_approval_count()` | StatBox |
| `is_user_admin(user_id)` | Action button gating |

## Klíčové workflows

| Workflow | Trigger | Účel |
|---|---|---|
| `WF_DRIFT_OBSERVER` | cron 10 min | Detekuje drift, auto-fix low/medium, escalates high/critical |
| `WF_BLUE_GREEN_ORCHESTRATOR` | webhook (CI/manual/drift-triggered) | Atomic B/G switch s smoke test + approval gate |
| `WF_SENTRY_OBSERVER` | cron 5 min | Korelace post-switch issues, navrhuje rollback (always approval) |
| `WF_APPSMITH_DASHBOARD_BUILDER` | cron 30 min + webhook | Regeneruje Appsmith dashboard from sources |
| `WF_APPROVAL_GATE` | webhook | Centrální human-in-the-loop pro high-risk akce (existing) |
| `WF_DEPLOY_STORY` | webhook | Standard story deploy (existing, integrates with phase 2 if app je B/G eligible) |

## Klíčové scripts

| Script | Účel |
|---|---|
| `scripts/coolify-drift-check.mjs --json` | Standalone drift checker (volaný z WF_DRIFT_OBSERVER) |
| `scripts/blue-green-switch.mjs` | Manual B/G switch CLI |
| `scripts/bootstrap-blue-green.mjs --apply` | Jednorázový setup B/G slot pairs (vytvoří duplicitní Coolify apps) |
| `scripts/build-aisha-appsmith.mjs` | Standalone Appsmith artifact builder — walks appsmith/{dashboards,pages}/*.template.json, testovatelný offline (testable offline) |

## Risk evaluation matrix

`fn_evaluate_proposal_risk` rozhoduje:

### `infrastructure_drift`

| Drift kind | Risk | Auto-fix? |
|---|---|---|
| `env_var_value` (non-secret, non-prod) | low | ✅ |
| `env_var_missing` | low | ✅ |
| `env_var_extra` | low | ✅ |
| `image_tag` (non-prod) | low | ✅ |
| `image_tag` (prod) | medium | ✅ + notify |
| `env_var_value` (prod) | medium | ✅ + notify |
| `replicas` / `traefik_labels` / `domain_mismatch` | medium | ✅ + notify |
| `secret_drift` | high | ❌ approval |
| `missing_app` | high | ❌ approval |
| Database role app drift (prod) | critical | ❌ approval |
| Auth role app drift | high | ❌ approval |
| `extra_app` | critical | ❌ approval |

### `blue_green_switch`

| Podmínka | Risk |
|---|---|
| Smoke test failed | high |
| Major semver image tag change | high |
| `triggered_by = 'manual'` | medium |
| `triggered_by = 'drift_remediation'` | medium |
| `triggered_by = 'ci_push'` && patch semver | low |
| `triggered_by = 'ci_push'` && minor semver | medium |

### `rollback`

Vždy `high` nebo `critical`. Production rollback s `fatal_count >= 10` = critical.

### `dashboard_rebuild`

Vždy `low` (read-only operation).

## Operativní recepty

### Recept: Ručně přenasadit VÍC aplikací (⛔ ne smyčkou přes API)

**Používej `scripts/aisha-redeploy.mjs`, ne vlastní smyčku nad `/api/v1/deploy`.**

```bash
node scripts/aisha-redeploy.mjs              # všechny, ve vlnách
node scripts/aisha-redeploy.mjs --only=core  # výběr
```

Ten skript nasazuje **ve vlnách podle závislostí** (18 definovaných) a mezi vlnami
**čeká na zdraví**, takže závislá služba startuje s živou závislostí:

```
vlna 1  registry, shared-redis          (čistá infra, bez závislostí)
vlna 2  core, pki, edge, clamav         (samostatné, paralelně)
vlna 3  keycloak                        (potřebuje db z vlny 2)
vlna 4  netbird, observability, orchestration, admin, ai-chat, realtime, …
```

⛔ **Proč ne smyčka přes `POST /api/v1/deploy?uuid=…`:** pořadí je pak dané tím,
jak apky vypadly ze seznamu. Keycloak (autentizační páteř) se restartuje současně
se vším, co na něm visí. Stalo se 2026-07-31 na 33 apkách naráz — dopadlo to dobře,
ale to je štěstí, ne postup. Jednu apku takhle nasadit lze; víc než jednu ne.

⚠️ **Fronta Coolify je omezená** — vrací `Deployment queue is full`. Skript to řeší
vlnami; ruční smyčka musí doplňovat, což je další důvod ji nepsat.

⚠️ **Přejímka: TAG OBRAZU, ne barva jobu** ani „healthy". `aisha-redeploy` ověřuje
ZDRAVÍ, což projde i se starým obrazem. A proti pohyblivému mainu (víc session
mergu je během dne) měř **vzdálenost v commitech**, ne shodu sha — shoda nevyjde,
ani když vše proběhlo správně:

```bash
git rev-list --count <sha-obrazu>..<fork>/main
```

### Recept: Investigovat drift

```bash
# 1. Co je aktuálně unresolved?
curl -X POST $POSTGREST_URL/rpc/get_latest_drift_state \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"p_limit": 50, "p_only_unresolved": true}'

# 2. Detail konkrétního app
curl -X POST $POSTGREST_URL/rpc/get_latest_drift_state \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"p_limit": 100, "p_only_unresolved": false}' \
  | jq '.[] | select(.app_name == "aisha-gateway")'

# 3. Manual run drift check
curl -X POST $N8N_WEBHOOK_URL/webhook/drift-now

# 4. Resolve manuálně (pokud admin opravil sám)
curl -X POST $POSTGREST_URL/rpc/resolve_drift \
  -d '{"p_drift_id": "uuid", "p_remediation": "manual", "p_resolution_note": "fixed via Coolify UI"}'
```

### Recept: Manual B/G switch

```bash
# CLI varianta
node scripts/blue-green-switch.mjs \
  --app aisha-gateway \
  --target-slot green \
  --image-tag sha-abc123

# Webhook varianta (pro testing)
curl -X POST $N8N_WEBHOOK_URL/webhook/blue-green-switch \
  -d '{
    "app_name": "aisha-gateway",
    "target_slot": "green",
    "image_tag": "sha-abc123",
    "triggered_by": "manual"
  }'
```

### Recept: Force rollback

```bash
# 1. Zjisti current active slot
curl $POSTGREST_URL/rpc/get_active_slots | jq '.[] | select(.app_name == "aisha-gateway")'

# 2. Vytvoř rollback request (autonomously approval-gated)
curl -X POST $POSTGREST_URL/rpc/request_rollback \
  -d '{"p_app_name": "aisha-gateway", "p_triggered_by": "manual"}'

# 3. Schvál v Slack notifikaci nebo přes dashboard Action button
```

### Recept: Manual dashboard rebuild

```bash
# Vyvolá WF_APPSMITH_DASHBOARD_BUILDER s force=true (skip hash check)
curl -X POST "$N8N_WEBHOOK_URL/webhook/appsmith-rebuild?force=true"

# Standalone offline rebuild (bez Appsmith importu) — všechny artefakty
node scripts/build-aisha-appsmith.mjs --dry-run

# Nebo jen konkrétní artefakt (např. AISHA Ops):
node scripts/build-aisha-appsmith.mjs --slug aisha-ops --dry-run
```

### Recept: Audit recent activity

```sql
-- Recent B/G switches
SELECT * FROM get_recent_b_g_switches(20);

-- Recent drift resolutions
SELECT * FROM audit_journal WHERE action LIKE 'drift%' ORDER BY created_at DESC LIMIT 50;

-- Recent rollbacks
SELECT * FROM get_rollback_history(20);

-- Pending approvals
SELECT * FROM integration_service_logs
WHERE action = 'approval_request_pending'
  AND COALESCE(action_detail->>'resolved', 'false') = 'false'
ORDER BY created_at DESC;
```

### ⛔ Deploy může být PŘIJAT a NEPROVEDEN

Změřeno 2026-07-31 po přenasazení 33 apek: dvě z nich (`<prefix>-model`,
`<prefix>-local-ingest`) vrátily `{"message":"… deployment queued."}`, fronta
`/api/v1/deployments` se vyprázdnila — a **kontejnery zůstaly nedotčené**:

```
local-ingest   Up 37 hodin   obraz d334bbbe   kontejner z 30. 7. 04:42
svc-model      Up 3 dny      obraz a5885bd9   kontejner z 22. 7. 17:10
```

Opakování s `force=true` nepomohlo. Není to fronta ani pomalý build.

⇒ **Odpověď API není přejímka.** Ani `running:healthy`. Jediný důkaz, že se
deploy provedl:

```bash
ssh <host> "docker inspect <kontejner> --format '{{.Created}}'"
git rev-list --count <sha-obrazu>..<fork>/main
```

Příčina nezjištěna — build logy se z Coolify API vytáhnout nedají, jsou v UI.

## Co která apka JE (aby se nesoudilo podle jména)

| apka | co v ní běží | co to NENÍ |
|---|---|---|
| `<prefix>-exec` | `svc-agent-runner` — AISHA si tudy pouští, co potřebuje | **NE CI runner.** CI běží na hostovaných runnerech GitHub Actions mimo tenhle cluster; na hostiteli instance žádný CI runner není. Nasazovat ji lze jako každou jinou. |

Zaznamenáno 2026-07-31: ze slova „runner" v názvu kontejneru jsem usoudil, že jde
o CI runner, a půl hodiny obcházel překážku, která neexistuje. Jméno kontejneru
není doklad o jeho roli — `docker ps` a compose ano.

## Bezpečnostní pravidla

1. **Nikdy** nevolat `commit_slot_switch` mimo orchestrator workflow — bypass smoke test
2. **Nikdy** přímo `UPDATE active_slot` v DB — neběží audit + RLS by mohl blokovat
3. Action buttons v dashboardu **musí** projít `is_user_admin()` check v webhook handleru — nestačí Appsmith UI hide
4. Drift remediation log obsahuje **diff**, ne plain values pro secrets — používej hash compare
5. Dashboard builder musí ověřit `appsmith.user.roles` přes OAuth2 Proxy headers, ne ze session storage

## Anti-patterns

❌ Direct UPDATE `coolify_app_slots.active_slot` (bypass lock)
❌ B/G switch bez smoke test mezi steps 4-5
❌ Auto-rollback bez `WF_APPROVAL_GATE` (rollback je vždy high-risk)
❌ Dashboard widget bez deterministic ID (re-import disrupts user state)
❌ Drift checker s plain secret values v output JSON

## Reference

- [`docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md`](docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md) — master spec
- [`docs/deploy/BLUE_GREEN_DESIGN.md`](docs/deploy/BLUE_GREEN_DESIGN.md) — Phase 2 detail
- [`docs/deploy/DRIFT_OBSERVER.md`](docs/deploy/DRIFT_OBSERVER.md) — Phase 1 detail
- [`docs/deploy/SENTRY_OBSERVER.md`](docs/deploy/SENTRY_OBSERVER.md) — Phase 3 detail
- [`docs/deploy/APPSMITH_AISHA_OPS.md`](docs/deploy/APPSMITH_AISHA_OPS.md) — Phase 4 detail
- [`deploy/connectors/coolify.mjs`](deploy/connectors/coolify.mjs) — Coolify API client
- [`coolify/servers.json`](coolify/servers.json) — server registry
- `n8n/workflows/WF_*` — workflow files
- `aisha/db/migrations/2026042810*` — Phase 0-4 migrations
