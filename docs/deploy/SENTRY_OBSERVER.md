# SENTRY_OBSERVER.md — Phase 3: Sentry-Driven Rollback

> **Status:** SPEC — Phase 3 z [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md)
> **Verze:** 1.0
> **Datum:** 2026-04-28

---

## TL;DR

AISHA každých 5 minut koreluje Sentry issues s nedávnými B/G switches. Pokud nový slot generuje fatální errors nad threshold v krátkém okně (≥3 fatal v 15 min), AISHA navrhne rollback. **Rollback je vždy high-risk → vždy projde `WF_APPROVAL_GATE`** — i když AISHA "ví", že má pravdu, lidský admin schvaluje.

---

## 1. Vztah k existujícímu `WF_SENTRY_MONITOR`

| Aspekt | `WF_SENTRY_MONITOR` (existing) | `WF_SENTRY_OBSERVER` (nový, Phase 3) |
|---|---|---|
| Účel | General alerting (fatal/error issues) | **Deploy correlation** + rollback signál |
| Frekvence | 15 min | 5 min |
| Scope | All Sentry projects | Pouze apps s recent B/G switch (last 30 min) |
| Action | Notify expert via Slack | Eskaluj přes `WF_APPROVAL_GATE` na rollback |
| Data sources | `get_sentry_monitor_configs` RPC | `get_active_slots` + `sentry-monitor` edge fn |
| Output | Slack notification | Approval request + audit log |

**Oba workflows koexistují.** WF_SENTRY_MONITOR pokrývá general health monitoring (15min cycle), WF_SENTRY_OBSERVER specializuje na deploy correlation (5min cycle, but scoped na recently-switched apps).

---

## 2. Komponenty

### 2.1 `n8n/workflows/WF_SENTRY_OBSERVER.json`

Nodes:

```
1. scheduleTrigger              (every 5 min)
2. aishaRpc                     (get_recent_switches RPC, last 30 min)
3. if                           (any switches found?)
   ├─ no → noOp (end)
   └─ yes → continue
4. splitInBatches              (batch_size: 1, per app)
5. aishaRpc                     (correlate_sentry_with_deploys RPC)
6. switch                       (route by rollback_recommended)
   ├─ false → log + noOp
   └─ true → continue
7. aishaRpc                     (fn_evaluate_proposal_risk('rollback', ...))
                                (always returns 'high' or 'critical')
8. httpRequest                  (POST /webhook/approval-gate)
9. aishaRpc                     (mark_rollback_pending_approval RPC)
10. log_integration_action      (sentry_observer_eskalovany_rollback)
```

### 2.2 RPC `correlate_sentry_with_deploys`

```sql
CREATE FUNCTION correlate_sentry_with_deploys(
  p_window_minutes int DEFAULT 15
) RETURNS TABLE (
  app_name text,
  active_slot text,
  switched_at timestamptz,
  last_image_tag text,
  fatal_count int,
  error_count int,
  warning_count int,
  new_issues_in_window int,
  unique_users_affected int,
  rollback_recommended boolean,
  rollback_reason text
)
SECURITY DEFINER SET search_path TO 'public'
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH recent_switches AS (
    SELECT
      cas.app_name,
      cas.active_slot,
      cas.last_switch_at,
      CASE cas.active_slot
        WHEN 'blue' THEN cas.blue_image_tag
        WHEN 'green' THEN cas.green_image_tag
      END AS image_tag
    FROM coolify_app_slots cas
    WHERE cas.last_switch_at > now() - interval '30 minutes'
      AND cas.last_switch_at IS NOT NULL
  ),
  sentry_window AS (
    SELECT
      sis.app_name,
      sis.level,
      sis.first_seen,
      sis.user_count,
      count(*) OVER (PARTITION BY sis.app_name, sis.level) AS lvl_count
    FROM sentry_issue_snapshot sis
    INNER JOIN recent_switches rs ON sis.app_name = rs.app_name
    WHERE sis.first_seen > rs.last_switch_at
      AND sis.first_seen < rs.last_switch_at + (p_window_minutes || ' minutes')::interval
  )
  SELECT
    rs.app_name,
    rs.active_slot,
    rs.last_switch_at AS switched_at,
    rs.image_tag AS last_image_tag,
    coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'fatal' LIMIT 1), 0) AS fatal_count,
    coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'error' LIMIT 1), 0) AS error_count,
    coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'warning' LIMIT 1), 0) AS warning_count,
    coalesce((SELECT count(DISTINCT first_seen) FROM sentry_window WHERE app_name = rs.app_name), 0)::int AS new_issues_in_window,
    coalesce((SELECT sum(user_count) FROM sentry_window WHERE app_name = rs.app_name), 0)::int AS unique_users_affected,
    -- Rollback recommended pravidla
    (
      coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'fatal' LIMIT 1), 0) >= 3
      OR coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'error' LIMIT 1), 0) >= 50
      OR coalesce((SELECT sum(user_count) FROM sentry_window WHERE app_name = rs.app_name), 0) >= 100
    ) AS rollback_recommended,
    CASE
      WHEN coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'fatal' LIMIT 1), 0) >= 3
        THEN '≥3 fatal issues po switchi'
      WHEN coalesce((SELECT lvl_count FROM sentry_window WHERE app_name = rs.app_name AND level = 'error' LIMIT 1), 0) >= 50
        THEN '≥50 error issues po switchi'
      WHEN coalesce((SELECT sum(user_count) FROM sentry_window WHERE app_name = rs.app_name), 0) >= 100
        THEN '≥100 dotčených uživatelů'
      ELSE NULL
    END AS rollback_reason
  FROM recent_switches rs;
END;
$$;

REVOKE ALL ON FUNCTION correlate_sentry_with_deploys(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION correlate_sentry_with_deploys(int) TO authenticated, service_role;
```

> **Poznámka**: tento RPC vyžaduje `sentry_issue_snapshot` table — periodicky populated z Sentry API. Bootstrap součástí Phase 3 implementace.

### 2.3 `sentry_issue_snapshot` table

```sql
CREATE TABLE sentry_issue_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at     timestamptz NOT NULL DEFAULT now(),
  sentry_issue_id text NOT NULL,
  app_name        text NOT NULL,           -- canonical (matches coolify_app_slots.app_name)
  project_slug    text NOT NULL,           -- Sentry project slug
  level           text NOT NULL CHECK (level IN ('fatal','error','warning','info','debug')),
  title           text NOT NULL,
  first_seen      timestamptz NOT NULL,
  last_seen       timestamptz NOT NULL,
  count           int NOT NULL DEFAULT 1,
  user_count      int NOT NULL DEFAULT 0,
  status          text NOT NULL,
  release         text,                     -- Sentry release tag (mapping na image_tag)
  metadata        jsonb DEFAULT '{}'::jsonb,
  UNIQUE (sentry_issue_id, observed_at)
);

CREATE INDEX idx_sentry_issue_snapshot_app ON sentry_issue_snapshot (app_name, first_seen DESC);
CREATE INDEX idx_sentry_issue_snapshot_recent ON sentry_issue_snapshot (observed_at DESC);
```

Periodicky populated:
- WF_SENTRY_MONITOR (existing) rozšířený o ingest do této tabulky
- Nebo separátní WF_SENTRY_INGEST — TBD při implementaci

### 2.4 `rollback_history` table

```sql
CREATE TABLE rollback_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name            text NOT NULL,
  triggered_at        timestamptz NOT NULL DEFAULT now(),
  triggered_by        text NOT NULL CHECK (triggered_by IN ('sentry_observer','manual','approval_gate')),
  from_slot           text NOT NULL,
  to_slot             text NOT NULL,
  from_image_tag      text,
  to_image_tag        text,
  sentry_correlation  jsonb,                    -- output of correlate_sentry_with_deploys
  approval_id         uuid,                     -- FK do integration_actions
  approval_status     text NOT NULL CHECK (approval_status IN ('pending','approved','rejected','expired','executed','failed')),
  approved_by         uuid,                     -- user_id approvera
  approved_at         timestamptz,
  executed_at         timestamptz,
  execution_status    text CHECK (execution_status IN ('success','failed','partial')),
  execution_details   jsonb,
  metadata            jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rollback_history_pending ON rollback_history (approval_status) WHERE approval_status = 'pending';
CREATE INDEX idx_rollback_history_app_recent ON rollback_history (app_name, triggered_at DESC);
```

---

## 3. Risk evaluation pro `rollback`

`fn_evaluate_proposal_risk('rollback', metadata)` má speciální chování — **vždy vrací `high` nebo `critical`**:

```typescript
metadata: {
  app_name: string;
  fatal_count: number;
  error_count: number;
  unique_users_affected: number;
  time_since_switch_min: number;
  is_production: boolean;
}
```

Pravidla:

| Podmínka | Risk |
|---|---|
| `fatal_count >= 10` && `is_production` | `critical` |
| `unique_users_affected >= 1000` && `is_production` | `critical` |
| `is_production` (any rollback in prod) | `high` |
| Staging/preview | `medium` (admin notify, ale bez gate) |

> **Princip**: rollback v produkci je **vždy** big deal. AISHA může být přesvědčena, ale finální slovo má human admin.

---

## 4. Approval gate flow

### 4.1 Request payload

```json
{
  "action_description": "Rollback aisha-gateway from green back to blue — 4 fatal Sentry issues since switch (8 min ago)",
  "severity": "high",
  "context": {
    "app_name": "aisha-gateway",
    "current_active_slot": "green",
    "rollback_target_slot": "blue",
    "switch_age_min": 8,
    "fatal_count": 4,
    "error_count": 12,
    "unique_users_affected": 87,
    "sentry_links": [
      "${SENTRY_URL}/aisha/aisha-gateway/issues/123456/",
      "${SENTRY_URL}/aisha/aisha-gateway/issues/123457/"
    ],
    "current_image_tag": "sha-def456",
    "rollback_image_tag": "sha-abc123",
    "rollback_history_id": "uuid-of-rollback-row"
  },
  "timeout_hours": 1,
  "agent_slug": "sentry_observer",
  "category": "rollback",
  "decision_reasoning": "Threshold met: 4 fatal issues in 8 minutes post-switch (threshold: >= 3 in 15 min). Recommend rollback to last known stable slot."
}
```

### 4.2 Timeout escalation

`timeout_hours: 1` — pokud není schválen do hodiny, escalation:
- Eskalovat na `notify_level: dirigent` (Slack ping admin/oncall channel)
- Zmírnit rollback decision (status: `expired`)
- Manuální action button v Phase 4 dashboardu zůstává dostupný

### 4.3 Po approval

1. Approval webhook callback → workflow s `rollback_history_id`
2. Workflow re-spustí B/G switch protocol z [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) §3
3. `target_slot = rollback_history.to_slot` (opačný k current `active_slot`)
4. Smoke test po rollback
5. Update `rollback_history` s `executed_at`, `execution_status`

---

## 5. False positive mitigation

Sentry-driven rollback je rizikový vůči false positives:

### 5.1 Filter pravidla

Před `correlate_sentry_with_deploys` se aplikují filtry:

1. **Issue must be NEW**: `first_seen > switched_at` (existing issues ignored)
2. **Release tag match**: pokud má issue `release` field, musí matchovat current slot's image_tag (ne starý)
3. **Issue type filter**: ignore `level = 'warning'` a níže
4. **Bot/automated traffic filter**: ignore issues s tag `user_agent: bot|crawler|monitoring`
5. **Throttle**: pokud rollback request pro app existuje v posledních 30 min, skip nový

### 5.2 Manual override

Admin může v `coolify_app_slots.metadata` nastavit:
```json
{ "sentry_observer_disabled": true, "reason": "Known issue, fix incoming", "until": "2026-04-29T12:00:00Z" }
```

Sentry observer respektuje tento flag (skip app pokud `now() < until`).

### 5.3 Decision provenance

Každá rollback decision loguje provenance řetězec:
```json
{
  "decision_provenance": [
    { "source": "ruleset_snapshot", "rule": "rollback_threshold_fatal", "value": 3, "applied": true },
    { "source": "compliance_policy", "rule": "production_rollback_requires_approval", "value": true, "applied": true },
    { "source": "model_heuristic", "rule": "auto_rollback_below_critical", "value": false, "applied": false, "reason": "compliance_policy overrides" }
  ]
}
```

---

## 6. Integration s ostatními fázemi

### 6.1 Sentry observer ↔ B/G

Phase 3 (Sentry observer) voltá Phase 2 (B/G orchestrator) s opačným slotem jako rollback. Phase 2 logiku 100% reused — nic specifického pro rollback flow, jen "deploy with target_slot = X, image_tag = Y".

### 6.2 Sentry observer ↔ Phase 4 dashboard

Dashboard zobrazuje:
- **Recent Sentry issues** (TableWidget z `sentry_issue_snapshot`, last 50)
- **Rollback history** (TableWidget z `rollback_history`)
- **Pending rollback approvals** (StatBoxWidget — count of rows where approval_status = 'pending')
- **Sentry × deploy timeline** (ChartWidget — issues vs switch timestamps)
- **Action button**: "Acknowledge issue" (links to Sentry UI), "Manual rollback" (admin only — bypassuje observer, jde přímo na B/G orchestrator)

### 6.3 Sentry observer ↔ Drift observer

Pokud rollback úspěšný, drift observer **bude** detekovat drift mezi `aisha-stack.yml` (které pinpne image_tag = sha-def456) a actual Coolify state (sha-abc123 po rollback). To je **expected** — admin po rollback musí buď:
- Manuálně updatovat `aisha-stack.yml` na rollback image
- Nebo redeploy s opraveným kódem (sha-ghi789), čímž manifest zůstane platný

Drift observer nemá auto-resolve pro tento případ — vyžaduje human decision přes approval gate (drift kind: `image_tag` v production = high risk).

---

## 7. Konfigurace

| Env var / config | Default | Účel |
|---|---|---|
| `SENTRY_OBSERVER_INTERVAL_MIN` | `5` | Cron interval |
| `SENTRY_OBSERVER_WINDOW_MIN` | `15` | Time window pro correlation |
| `SENTRY_OBSERVER_FATAL_THRESHOLD` | `3` | Fatal count → rollback recommend |
| `SENTRY_OBSERVER_ERROR_THRESHOLD` | `50` | Error count → rollback recommend |
| `SENTRY_OBSERVER_USER_THRESHOLD` | `100` | Affected users → rollback recommend |
| `SENTRY_OBSERVER_THROTTLE_MIN` | `30` | Min minutes between rollback requests per app |
| `SENTRY_OBSERVER_DRY_RUN` | `false` | Pokud true, jen loguje, nevyvolává approval |

---

## 8. Otevřené otázky

1. **Auto-rollback bez approval pro extrém critical**: pokud `fatal_count >= 50` v <2 min, je to clearly broken deploy — má smysl auto-rollback? Riziko: false positive při Sentry outage. — *zvážit po měření*
2. **Multi-issue correlation**: pokud 5 různých appů zobrazí rollback signál současně, je to pravděpodobně shared issue (např. DB problém), ne deploy. RPC má zatím per-app logiku. — *future enhancement: cross-app correlation*
3. **Sentry release tagging**: workflow musí ověřit, že se Sentry release tag v issue match s current image_tag. Pokud release tag missing, fallback na `first_seen > switched_at`. — *cesta k implementaci: CI/CD musí publishovat Sentry release při každém deploy*

---

## 9. Reference

- [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md) — master spec
- [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) — Phase 2, Phase 3 voltá B/G logiku pro rollback
- [APPSMITH_AISHA_OPS.md](APPSMITH_AISHA_OPS.md) — Phase 4 vizualizace rollback history
- [WF_SENTRY_MONITOR.json](../../n8n/workflows/WF_SENTRY_MONITOR.json) — existing general alerting
- [WF_APPROVAL_GATE.json](../../n8n/workflows/WF_APPROVAL_GATE.json) — approval flow contract
- [Sentry API: Issues](https://docs.sentry.io/api/events/list-a-projects-issues/)
- [Sentry API: Releases health](https://docs.sentry.io/api/releases/list-a-releases-health-data/)
