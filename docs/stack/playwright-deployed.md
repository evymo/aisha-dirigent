# Playwright against deployed environments

E2E tests against a **deployed** stack — staging automatically after every
deploy, production manually on operator request. Runs inside a dedicated
container with Chromium pre-installed, hits the deployed `target_base_url`,
uploads the HTML report + traces + videos, records pass/fail counts to
`audit_journal`.

## Why a separate runner

`npm run test:e2e:local` and `npm run test:e2e:container` exist for
**local-development** validation (full stack `docker-compose.e2e.yml`).
This new runner is different:

- Target is a **deployed URL** (e.g. `https://stage.aisha.guru`), not
  `http://localhost:8080`.
- Trigger is **automatic** (staging deploy ⇒ staging_auto) or
  **operator-driven** (production_manual, with approval gate).
- Results are **audited**: every run writes `audit_journal` with tags
  `['stack','qa','playwright',<trigger>,<result>]` and uploads the HTML
  report into `e2e-reports/<run_id>/index.html` (private storage bucket;
  admin/staff SELECT, service_role ALL).
- Production runs require **explicit approval** — operator calls
  `approve_playwright_run(run_id)` before the runner picks the row up.

## Container

`services/svc-playwright-runner/Dockerfile` builds on
`mcr.microsoft.com/playwright:v1.59.1-jammy` (Microsoft's official image —
Chromium + Firefox + WebKit + Node + all browser deps pre-installed).
The spec suite (`e2e/`) is **bind-mounted** so a push to main updates the
suite without rebuilding the image. The container has no HTTP listener;
it polls `get_next_playwright_run` every 30 s and shuts down on SIGTERM.

## Flow

```
operator   ──── n8n webhook /playwright-run ────►  WF_PLAYWRIGHT_RUN
                                                   ↓
                                        start_playwright_run RPC
                                                   ↓
                                   playwright_runs row (status=queued)
                                                   ↓
                       svc-playwright-runner polls (get_next_playwright_run)
                                                   ↓
                                  mark_playwright_run_running → status=running
                                                   ↓
                       PLAYWRIGHT_BASE_URL=target_url npx playwright test
                                                   ↓
                       upload report dir → e2e-reports/<run_id>/...
                                                   ↓
                       record_playwright_result → status=passed/failed/errored
                                                   ↓
                                            audit_journal row
```

For `production_manual` the runner SKIPS rows where
`approval_required = true AND approved_at IS NULL`. The admin must call
`approve_playwright_run(run_id)` (audited) before the queue picks it up.

## Triggering a run

### Staging auto (called from `WF_DEPLOY_STORY` after a staging deploy)

```bash
curl -X POST "${AISHA_GATEWAY_URL}/webhook/playwright-run" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SERVICE_TOKEN}" \
  -d '{
    "trigger_kind": "staging_auto",
    "target_env": "staging",
    "target_base_url": "https://stage.aisha.guru",
    "suite": "all",
    "deploy_ref": "v1.2.3-rc1"
  }'
```

### Production manual (operator only, requires approval)

```bash
# 1. enqueue (any admin / service-role can call)
curl -X POST "${AISHA_GATEWAY_URL}/webhook/playwright-run" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{
    "trigger_kind": "production_manual",
    "target_env": "production",
    "target_base_url": "https://app.aisha.guru",
    "suite": "e2e/admin-flows.spec.ts",
    "deploy_ref": "v1.2.3"
  }'
# → { ok: true, run_id: "<uuid>", approval_required: true }

# 2. approve (different admin recommended — segregation of duties)
curl -X POST "${AISHA_GATEWAY_URL}/rest/v1/rpc/approve_playwright_run" \
  -H "content-type: application/json" \
  -H "apikey: ${ADMIN_JWT}" -H "authorization: Bearer ${ADMIN_JWT}" \
  -d '{"p_run_id":"<uuid>"}'

# Runner picks the row up within poll interval (~30 s).
```

### Inspecting results

```sql
SELECT id, trigger_kind, target_env, status, passed, failed, duration_ms,
       report_storage_path, finished_at
FROM playwright_runs
ORDER BY created_at DESC
LIMIT 20;
```

HTML report is served from the `e2e-reports` bucket — admin/staff have
SELECT, build a signed URL via standard storage API or use the future
`/admin/qa/playwright` dashboard.

## Suite filtering

`suite` is either `'all'` (whole `e2e/` directory) or a single spec path
relative to repo root, e.g. `e2e/admin-flows.spec.ts`. Glob patterns are
TODO; trade-off is the JSON-RPC contract simplicity.

## Storage layout

```
e2e-reports/
  <run_id>/
    html/
      index.html         ← human report (the one operators want)
      ...                ← assets
    results.json         ← machine-readable summary
    test-results/        ← per-test traces + screenshots + videos
    runner.log           ← stdout/stderr of the playwright invocation
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Run stuck in `queued` for >2 poll intervals | Runner not up / hit timeout / gateway unreachable | `docker logs aisha-svc-playwright-runner`; check `AISHA_GATEWAY_URL` |
| Run goes `queued → errored`, no counts | `results.json` not produced — runner.log has the reason | Open `e2e-reports/<run_id>/runner.log` |
| `production_manual` queued forever | `approval_required=true` but no `approve_playwright_run` called | Have an admin run the RPC |
| Browser binary mismatch error | `@playwright/test` in repo bumped but image not rebuilt | Update `services/svc-playwright-runner/Dockerfile` FROM tag to match `e2e`'s package version |

## Why not run from CI directly?

We could (and `npm run test:e2e:container` does, for local dev). But:

- **Staging auto** wants tight coupling to the deploy — when staging
  flips B/G slot, fire the suite at the new live URL within the same
  pipeline. The runner sitting inside the same stack as the deploy
  flow makes that idempotent + audited.
- **Production manual** wants the approval gate inside the audit story,
  not as a separate CI button. Storing the queue + approval in the same
  RPC + audit_journal as everything else means one query gives full
  history.
- **Operator-facing rationale**: each stack instance (the upstream Aisha
  stack / a partner tenant / a law firm / accounting office) gets the same on-demand QA
  capability without depending on external CI runners they may not own.

## Production integration (migration `20260518040000`)

The MVP runner is wired into the live deploy + B/G slot + storyloop loop so
QA outcomes flow into the same audit + rollback paths everything else uses:

### 1. `app_name` + `target_base_url='auto'` → live slot URL

```bash
curl -X POST "${AISHA_GATEWAY_URL}/webhook/playwright-run" \
  -H "content-type: application/json" \
  -d '{
    "trigger_kind": "staging_auto",
    "target_env": "staging",
    "target_base_url": "auto",
    "app_name": "stack-aisha-staging",
    "story_id": "<uuid>",
    "suite": "all"
  }'
```

`start_playwright_run` calls `resolve_deployed_url(app_name)` and pulls
`coolify_app_slots.domain` + `active_slot` for the row. The active slot is
captured on the run so a mid-flight B/G switch can't misroute follow-ups.

### 2. WF_DEPLOY_STORY chains staging deploys automatically

`WF_DEPLOY_STORY` now accepts `app_name` + `playwright: false` (opt-out)
+ `playwright_suite` and, after a successful staging deploy, posts to
`/webhook/playwright-run` with `trigger_kind='staging_auto'` and
`target_base_url='auto'`. Failures inside the chain are soft so a
Playwright outage cannot mask a deploy success.

### 3. Auto-rollback on staging_auto failure

`record_playwright_result` detects `trigger_kind='staging_auto' + result IN
('failed','errored') + app_name IS NOT NULL` and calls the existing
`request_rollback(app_name, 'playwright_staging_auto', …)` RPC. The
returned `rollback_history.id` is linked on `playwright_runs.triggered_rollback_id`.
The 30-min throttle in `request_rollback` still applies; the runner
soft-fails on throttle and writes `PLAYWRIGHT_RUN_ROLLBACK_THROTTLED` to
audit_journal.

### 4. B/G slot health updates

When a run is app-linked, `record_playwright_result` updates
`coolify_app_slots.{active_slot}_health` to `'healthy'` (pass) or
`'degraded'` (fail/error). The Sentry observer / blue-green orchestrator
read this column and already know what to do.

### 5. Story timeline entries

When `story_id` is passed, the lifecycle emits four story_entries
mirroring the `web_artifact_*` pattern:

| entry_type | when | created_by |
|---|---|---|
| `qa_playwright_requested` | `start_playwright_run` | requesting user |
| `qa_playwright_approved` | `approve_playwright_run` | approving admin |
| `qa_playwright_passed` | `record_playwright_result` (passed) | NULL (service) |
| `qa_playwright_failed` | `record_playwright_result` (failed/errored) | NULL (service) |

Storyloop blocks (`QaPlaywright{Requested,Approved,Passed,Failed}Block.tsx`)
render these inline with the rest of the timeline.

### 6. Segregation of duties on production approval

`approve_playwright_run` rejects the request when `approved_by = requested_by`.
Production_manual runs require two distinct admin identities, audited.

## Out of scope / follow-ups

- Glob suite filter (multi-spec selection beyond `all` / single path).
- Parallel sharding across multiple runner replicas (current: one
  serial worker per stack).
- React admin QA dashboard at `/admin/qa/playwright`.
- Cross-app dependency graph (if a staging_auto run failure of one app
  should pre-empt staging deploys of dependent apps).
