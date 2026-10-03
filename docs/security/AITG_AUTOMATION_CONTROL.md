# AITG Automation Control — operator runbook

> **Status:** wired (2026-05-16).
> **Audience:** AISHA platform admins / security operators / Aisha herself.
> **Purpose:** every AITG automation (continuous heartbeat, daily reflection,
> nightly sweep, drift detector, auto-close, runtime sentinel, PR gate,
> call-site guard defaults) is **configurable from the DB**, **visible in
> Appsmith**, and **manually triggerable** through one button.

## Why this exists

Burying schedules in n8n workflow JSON files makes them invisible:
operators can't tell at a glance which loops are running, can't switch a
loop from automated to manual without a deploy, and can't trigger a one-off
run without opening n8n's UI. The settings table fixes that: one row per
loop, four mutation paths (mode, cron, interval, parameters), and a single
admin page in Appsmith.

## Data model

`public.aitg_automation_settings`

| Column | Type | Notes |
|---|---|---|
| `automation_id` | text PK | `^[a-z][a-z0-9_]+$` (e.g. `continuous_heartbeat`) |
| `display_name` | text | Operator-friendly label |
| `description` | text | One-sentence summary shown in Appsmith |
| `mode` | text | `automated` / `manual` / `disabled` |
| `schedule_cron` | text | 5-field crontab (or null) |
| `schedule_interval_minutes` | int | 1..1440 (or null) |
| `parameters` | jsonb | Per-loop knobs (`queue_limit`, `drop_threshold_pp`, …) |
| `workflow_id` | text | n8n workflow id (when applicable) |
| `last_run_at` | timestamptz | Updated by `aitg_record_automation_run_audited` |
| `last_run_status` | text | `success`/`failed`/`skipped`/`running` |
| `last_run_details` | jsonb | Free-form, includes `trigger_id` for manual runs |
| `updated_by` | uuid | Last admin who changed cadence |

## The 8 seeded automations

| id | display name | default cadence | parameters |
|---|---|---|---|
| `continuous_heartbeat` | Continuous probe heartbeat | every 15 min | `queue_limit`, `priority_floor` |
| `daily_reflection` | Daily reflection (Aisha diary) | cron `0 6 * * *` | `window_hours`, `history_days`, `model` |
| `nightly_full_sweep` | Nightly full corpus sweep | cron `30 3 * * *` | `batch_size`, `cost_ceiling_usd` |
| `drift_detection` | WoW drift detection | every 60 min | `window_hours`, `min_runs`, `drop_threshold_pp` |
| `auto_close_findings` | Auto-close fixed findings | every 30 min | `required_consecutive_passes` |
| `runtime_sentinel` | Runtime sentinel (Langfuse anomaly) | event-driven | `anomaly_threshold` |
| `pr_gate` | PR gate (static + runtime) | event-driven | `block_severity`, `allow_waivers` |
| `callsite_guard_default` | Call-site guard default | event-driven | `enabled_tests`, `refuse_on_violation` |

## How the runtime contract works

Each `WF_AITG_*` workflow follows the same shape:

```
trigger (cron / webhook / interval)
  → aitg_get_automation_audited(automation_id)
  → IF mode = automated (or manual + trigger_id present)
       → do the work
       → aitg_record_automation_run_audited(status='success')
     ELSE
       → aitg_record_automation_run_audited(status='skipped')
```

`shouldRunNow(setting, triggerId?)` in [`packages/aitg/src/automation.ts`](../../packages/aitg/src/automation.ts) is the
pure decision function — same logic in JS (for tests) and the workflow's
`Should Run?` IF node.

## Operator surface — Appsmith page

[`appsmith/pages/aitg-automation-control.template.json`](../../appsmith/pages/aitg-automation-control.template.json) ships a page with:

- 4 KPI stat boxes (trust score, open findings, drift alerts, runs/24h)
- Sortable + filterable table of all 8 automations
- 3 action buttons on selected row:
  - **Trigger Now** — manual run regardless of mode (returns `trigger_id`)
  - **Edit Settings** — modal form for mode / cron / interval / parameters JSON
  - **Disable** — confirmation-gated, sets `mode = disabled`
- All queries hit audited RPCs; every operator action lands in `audit_journal`

Import via the existing AISHA Ops Appsmith app (the page is a JSON template
consumed by `WF_APPSMITH_DASHBOARD_BUILDER`).

## RPC reference

| RPC | Caller | Purpose |
|---|---|---|
| `aitg_list_automations_audited()` | Appsmith + Aisha | List all 8 rows |
| `aitg_get_automation_audited(id)` | Workflows + Aisha | Read one row |
| `aitg_update_automation_audited(id, mode, cron, interval, params)` | **Admin only** | Change cadence/mode/knobs |
| `aitg_trigger_automation_audited(id, initiator)` | Admin + Aisha + workflows | Manual run; returns `trigger_id` |
| `aitg_record_automation_run_audited(id, status, details)` | Workflow callback | Update `last_run_*` columns |

Mutation RPC (`update`) is admin-only (no `service_role` fallback) — Aisha
can read and trigger, but cannot change cadence without operator approval.
Aisha proposes changes by writing them into her reflection summary; an
operator promotes them through Appsmith.

## MCP tools (Aisha)

Aisha uses 5 MCP tools backed by the same RPCs:

| MCP tool | Aisha uses it for |
|---|---|
| `aitg_list_automations` | "What loops are running, and on what schedule?" |
| `aitg_get_automation` | "Read this loop's last-run + params" |
| `aitg_trigger_automation` | "Run this loop once now (e.g. before submitting a remediation proposal)" |
| `aitg_update_automation` | **Admin only** — Aisha can't mutate; she gets `AITG_INSUFFICIENT_PRIVILEGE` |
| `aitg_record_automation_run` | Workflow callback (service-role) |

## Common operator queries

```sql
-- Current cadence of every loop, sorted by recency of last run
SELECT automation_id, display_name, mode,
       schedule_cron, schedule_interval_minutes,
       last_run_status, last_run_at
FROM aitg_list_automations_audited()
ORDER BY last_run_at DESC NULLS LAST;

-- Switch the continuous heartbeat from 15min → 5min (more aggressive)
SELECT aitg_update_automation_audited(
  'continuous_heartbeat', NULL, NULL, 5,
  jsonb_build_object('queue_limit', 2, 'priority_floor', 0.3)
);

-- Pause the nightly sweep (cost control)
SELECT aitg_update_automation_audited('nightly_full_sweep', 'disabled', NULL, NULL, NULL);

-- Manual one-off — trigger daily reflection regardless of cron
SELECT aitg_trigger_automation_audited('daily_reflection', 'operator:alice');

-- Audit trail of every operator change in the past 7 days
SELECT created_at, user_id, action, details
FROM audit_journal
WHERE 'automation' = ANY(tags)
  AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC;
```

## Adding a new automation

1. Add the row to the seed `INSERT … ON CONFLICT DO UPDATE` block in the
   migration (idempotent).
2. Add the id to `AITG_AUTOMATION_IDS` in `packages/aitg/src/automation.ts`.
3. Write the workflow to call `aitg_get_automation_audited` at start +
   `aitg_record_automation_run_audited` at end.
4. The discovery gate in `src/tests/gates/aitg/aitg-automation-control.gate.test.ts`
   will fail if the new id is referenced but not seeded — keeps the three
   sources of truth in sync.

## References

- Companion runbooks: [AITG_INTEGRATION.md](AITG_INTEGRATION.md) (full system), [OWASP_ORCHESTRATOR.md](OWASP_ORCHESTRATOR.md) (overall Top 10)
- Migration: [`20260516162046_aitg_automation_settings.sql`](../../aisha/db/migrations/20260516162046_aitg_automation_settings.sql)
- Page template: [`appsmith/pages/aitg-automation-control.template.json`](../../appsmith/pages/aitg-automation-control.template.json)
- Gate: [`aitg-automation-control.gate.test.ts`](../../src/tests/gates/aitg/aitg-automation-control.gate.test.ts)
