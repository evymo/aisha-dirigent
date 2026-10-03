# Playwright QA — operator runbook

> **Status:** wired (2026-05-18).
> **Audience:** AISHA platform admins / on-call operators.
> **Purpose:** Every Playwright run that hits a deployed env is **visible
> in Appsmith**, **approvable from one button** (production), and emits
> structured story + audit entries that the rest of the platform can react
> to (auto-rollback, B/G slot health, storyloop timeline).

## Where it lives

| Surface | Path | Notes |
|---|---|---|
| Admin dashboard | Appsmith app `AISHA Ops` → page `Playwright QA` | Template: `appsmith/pages/playwright-qa.template.json` |
| Operator timeline | Storyloop view (partner-facing + admin) | Blocks: `qa_playwright_{requested,approved,passed,failed}` |
| Webhook | `POST /webhook/playwright-run` (via n8n `WF_PLAYWRIGHT_RUN`) | Accepts `target_base_url='auto'` + `app_name` |

## Data model

`public.playwright_runs` (one row per invocation):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `trigger_kind` | enum | `staging_auto` / `production_manual` / `scheduled` |
| `target_env` | text | e.g. `staging`, `production`, `tenant-staging` |
| `target_base_url` | text | http(s) URL the runner hits |
| `suite` | text | `all` or a single spec path |
| `deploy_ref` | text | commit/tag of the deployed build |
| `status` | enum | `queued` → `running` → `passed`/`failed`/`errored`/`aborted` |
| `total/passed/failed/skipped` | int | runner-reported counts |
| `duration_ms` | int | |
| `report_storage_path` | text | `e2e-reports/<run_id>/html/index.html` |
| `requested_by` / `approved_by` | uuid | auth.uid() at start / approval |
| `approval_required` | bool | true for `production_manual`; runner skips until `approved_at` is set |
| `app_name` | text | `coolify_app_slots.app_name`; enables URL auto-resolve + slot-health updates |
| `active_slot` | enum | captured at start time so a mid-run switch can't misroute the rollback wire |
| `story_id` | uuid | when set, lifecycle emits `qa_playwright_*` entries on the storyloop timeline |
| `triggered_rollback_id` | uuid | populated when staging_auto failure auto-requests a rollback |

## RPCs

| RPC | Auth | When called |
|---|---|---|
| `start_playwright_run(trigger_kind, target_env, target_base_url, suite, deploy_ref, metadata, story_id, app_name)` | admin/staff OR service_role | Webhook entry point. `target_base_url='auto'` + `app_name` → resolves URL from coolify_app_slots, captures active_slot. |
| `mark_playwright_run_running(p_run_id)` | service_role | Runner picks the row up; flips status to `running`. |
| `record_playwright_result(...)` | service_role | Final counts + report path. Updates `{active_slot}_health`, auto-calls `request_rollback()` on `staging_auto` failure (throttled), emits `qa_playwright_passed`/`_failed`. |
| `approve_playwright_run(p_run_id)` | admin/staff | Unlocks a `production_manual` queued run. **Approver MUST differ from requester** (segregation of duties enforced in the RPC). |
| `fail_playwright_run(p_run_id, p_error)` | service_role | Operator-side abort. |
| `get_next_playwright_run()` | service_role | Polled by the runner; skips rows where `approval_required=true AND approved_at IS NULL`. |
| `list_playwright_runs(p_limit, p_status_filter, p_window_hours)` | admin/staff | Audited read for the dashboard table. |
| `get_playwright_runs_health_summary(p_window_hours)` | admin/staff | Audited read for the dashboard stat cards. |
| `resolve_deployed_url(p_app_name)` | authenticated, service_role | Helper used internally by `start_playwright_run` when `target_base_url='auto'`. |

## End-to-end flow

```
operator (Appsmith button) ─┐
                            ├──► POST /webhook/playwright-run
WF_DEPLOY_STORY ────────────┘                  │
                                               ▼
                                  WF_PLAYWRIGHT_RUN (n8n)
                                               │
                                               ▼
                                  start_playwright_run RPC
                                               │
                       (story_id set?  qa_playwright_requested entry)
                                               │
                                               ▼
                                  playwright_runs row (queued)
                                               │
                       (production_manual?  awaiting approval ──► approve_playwright_run)
                                               │
                                               ▼
                       svc-playwright-runner picks up (get_next_playwright_run)
                                               │
                                               ▼
                       mark_playwright_run_running → running
                                               │
                       PLAYWRIGHT_BASE_URL=target_url npx playwright test
                                               │
                       upload report → e2e-reports/<run_id>/…
                                               │
                                               ▼
                       record_playwright_result
                          ├── coolify_app_slots.{slot}_health updated
                          ├── staging_auto + failed → request_rollback() (throttled)
                          ├── qa_playwright_passed | qa_playwright_failed
                          │   story_entry
                          └── audit_journal: PLAYWRIGHT_RUN_RESULT
```

## Common operator tasks

### 1. Approve a production run

1. Open **AISHA Ops → Playwright QA**.
2. Stat card **Awaiting Approval** > 0 ⇒ filter the table by status `queued` + approval `pending`.
3. Select the row, hit **Approve Run**.
   * Button is **disabled** when `requested_by === your-user-id` (you cannot self-approve).
4. Runner picks it up within poll interval (≤ 30 s).

### 2. Trigger an ad-hoc run

1. Click **Trigger Run** (top right).
2. **Resolve URL from coolify_app_slots** is on by default — fill `app_name` and the URL comes from the live B/G slot.
3. Pick a `target_env`, optional `suite`, `deploy_ref`, `story_id`.
4. Production runs queue with `approval_required = true`; another admin approves.

### 3. View an HTML report

1. Select the run row.
2. Click **View Report**. The button audits the access intent
   (`appsmith / playwright_report_view`) and opens an iframe pointing at
   `<gateway>/storage/v1/object/e2e-reports/<run_id>/html/index.html`. The
   bucket has admin/staff SELECT — the iframe loads using your existing
   session, no signed URL needed.

### 4. Jump to the related story

If a run is story-linked, click **Open Story** (table-row action) — opens
the `story-intra` page in a new tab.

### 5. Understand a triggered rollback

When the Rollback column shows `🔄 <prefix>`, an automatic rollback was
requested because the run failed on `staging_auto` for an app-linked deploy.
The full row lives in `rollback_history` keyed by `triggered_rollback_id`.

## Failure modes & remediation

| Symptom | Likely cause | Fix |
|---|---|---|
| Run stuck in `queued` > 2 poll intervals | Runner not up / hit timeout / gateway unreachable | `docker logs aisha-svc-playwright-runner`; check `AISHA_GATEWAY_URL` |
| Run goes `queued → errored`, no counts | `results.json` not produced — runner.log has the reason | Open `e2e-reports/<run_id>/runner.log` from the iframe |
| Production run queued forever | `approval_required=true` but nobody called `approve_playwright_run` | Have a *different* admin approve |
| `PLAYWRIGHT_RUN_ROLLBACK_THROTTLED` in audit | An open rollback for the same app in the last 30 min | Either wait for the existing one to settle, or escalate to manual rollback via the deploy ops page |
| Approve button always disabled | You're the requester | Different admin must approve (segregation of duties) |

## Why a separate Appsmith page (not React admin)

Every operator dashboard in the AISHA stack lives in Appsmith — the AITG
automation page, the deploy ops page, the Sentry/Langfuse panes. This
keeps the operator surface coherent (single sign-on, single navigation,
single permissions model), and lets us ship dashboards as **JSON
templates that can be regenerated** by `WF_APPSMITH_DASHBOARD_BUILDER`.
A separate React admin tree would diverge over time.

## Gate coverage

* `src/tests/gates/playwright/playwright-qa.gate.test.ts` asserts:
  * every RPC is SECURITY DEFINER + REVOKE/GRANT-disciplined
  * Appsmith page wires the canonical RPCs
  * Approve button enforces the requester-≠-approver invariant
  * Trigger Run modal defaults to `'auto'` URL resolution
