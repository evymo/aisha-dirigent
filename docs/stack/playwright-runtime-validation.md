# Playwright runner — runtime validation runbook

> **Status:** wired (2026-05-19).
> **Audience:** AISHA platform admins / on-call operators.
> **Purpose:** validate that the deployed `svc-playwright-runner` actually
> runs end-to-end against a real staging deploy — gates can verify the
> code shape, this runbook verifies the runtime wiring.

## Why this runbook exists

PR #69 / #91 shipped the Playwright runner + `WF_DEPLOY_STORY` chain +
auto-rollback wire-up. All gate-tested statically. Gates **cannot**
catch:

- Coolify slot resolver returning a stale or wrong domain after a
  rename/redeploy
- Verdaccio token scope problems inside the runner container at
  install-time
- `e2e-reports` storage bucket RLS regression (admin/staff SELECT broken)
- Network reachability between runner container and the deployed target

This runbook gives you a **5-minute end-to-end check** plus a fast
preflight script that runs in under 10 seconds.

## Quick preflight (no side effects)

```bash
node scripts/playwright-runner-preflight.mjs --app-name stack-aisha-staging
```

Output:

```
ℹ Playwright runner preflight — app_name=stack-aisha-staging
✓ coolify_app_slots row exists — active_slot=blue, domain=stage.aisha.guru
✓ resolve_deployed_url returns valid URL — target_base_url=https://stage.aisha.guru
✓ target URL reachable (HTTP HEAD) — HTTP 200 from https://stage.aisha.guru
✓ runner heartbeat fresh — heartbeat 12s old
✓ e2e-reports storage bucket policy (admin/staff SELECT) — reachable
✓ lifecycle RPC auth path probed via get_playwright_runs_health_summary

━━ summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ 6 passed   ⚠ 0 warned   ✗ 0 failed
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | All checks passed |
| 1 | One or more critical checks failed — fix before triggering a real run |
| 2 | Misconfiguration (missing `--app-name`, no `AISHA_POSTGREST_SERVICE_KEY`) |

Flags:

| Flag | Purpose |
|---|---|
| `--json` | Emit a JSON report to stdout (status only — for CI integration) |
| `--quiet` | Suppress human progress; pair with `--json` for machine output |

## End-to-end runtime validation (5 minutes)

When you want full confidence — i.e. **the preflight passed and you
want to verify a real run lifecycle** — follow these steps. Use a
non-prod app where a few minutes of QA noise is acceptable.

### Setup

```bash
# 1. Pick a non-prod app
APP=stack-aisha-staging

# 2. Create a throwaway story for the run to attach to
STORY_ID=$(curl -sf -X POST "${AISHA_POSTGREST_URL}/rest/v1/rpc/create_story_audited" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AISHA_POSTGREST_SERVICE_KEY}" \
  -H "Authorization: Bearer ${AISHA_POSTGREST_SERVICE_KEY}" \
  -d '{"p_title":"Playwright runtime validation 2026-05-19","p_status":"inbox"}' | jq -r '.id')
echo "story_id=$STORY_ID"
```

### Trigger a manual run

```bash
# Webhook into WF_PLAYWRIGHT_RUN with target_base_url='auto' (the RPC
# will resolve from coolify_app_slots) + story_id (so we get
# qa_playwright_* entries on the storyloop timeline)

curl -X POST "${AISHA_GATEWAY_URL}/webhook/playwright-run" \
  -H "content-type: application/json" \
  -d "{
    \"trigger_kind\": \"production_manual\",
    \"target_env\": \"staging\",
    \"target_base_url\": \"auto\",
    \"app_name\": \"$APP\",
    \"story_id\": \"$STORY_ID\",
    \"suite\": \"e2e/admin-overview.spec.ts\",
    \"deploy_ref\": \"runtime-validation-2026-05-19\"
  }"
```

Expected response:

```json
{
  "ok": true,
  "run_id": "<uuid>",
  "approval_required": true,
  "message": "Queued; awaiting admin approval (call approve_playwright_run RPC)."
}
```

### Observe the lifecycle

**1. Story entry `qa_playwright_requested` appears immediately:**

```sql
SELECT entry_type, content, created_at
FROM story_entries
WHERE story_id = $1
ORDER BY created_at DESC LIMIT 5;
```

Expected first row:

| entry_type | content |
|---|---|
| `qa_playwright_requested` | `{"run_id": "...", "trigger_kind": "production_manual", "app_name": "stack-aisha-staging", "active_slot": "blue", "approval_required": true, ...}` |

**2. The run sits in `queued` state — approve as a different admin:**

```bash
curl -X POST "${AISHA_POSTGREST_URL}/rest/v1/rpc/approve_playwright_run" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ADMIN_JWT_DIFFERENT_USER}" \
  -H "Authorization: Bearer ${ADMIN_JWT_DIFFERENT_USER}" \
  -d "{\"p_run_id\":\"<run_id>\"}"
```

Expected: `qa_playwright_approved` story entry, `playwright_runs.approved_at IS NOT NULL`.

**3. Runner picks up the row within ~30s (default poll interval):**

```sql
SELECT id, status, started_at FROM playwright_runs WHERE id = $1;
```

Expected progression: `queued` → `running`. If it stays in `queued` for >60s, check:

```bash
docker logs aisha-svc-playwright-runner --tail 50
```

**4. After test execution finishes (variable, usually <5 min for one spec):**

```sql
SELECT status, total, passed, failed, duration_ms, report_storage_path,
       app_name, active_slot, story_id, triggered_rollback_id
FROM playwright_runs WHERE id = $1;
```

Expected (passing run):

| Field | Value |
|---|---|
| `status` | `passed` |
| `report_storage_path` | `e2e-reports/<run_id>/html/index.html` |
| `app_name` | `stack-aisha-staging` |
| `active_slot` | `blue` (or `green` — whichever was active) |
| `triggered_rollback_id` | `NULL` (only set on staging_auto failures) |

**5. B/G slot health updated:**

```sql
SELECT blue_health, green_health FROM coolify_app_slots WHERE app_name = $1;
```

The `<active_slot>_health` column should now be `healthy`.

**6. Story timeline shows `qa_playwright_passed`:**

```sql
SELECT entry_type, content->>'result_status' as result, content->>'duration_ms' as duration
FROM story_entries
WHERE story_id = $1
ORDER BY created_at DESC LIMIT 1;
```

### Negative test: failing run on staging_auto path

To verify auto-rollback works, trigger a known-failing suite via the
`staging_auto` path (only callable by `service_role`, so simulate via
direct RPC):

```bash
curl -X POST "${AISHA_POSTGREST_URL}/rest/v1/rpc/start_playwright_run" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -d "{
    \"p_trigger_kind\": \"staging_auto\",
    \"p_target_env\": \"staging\",
    \"p_target_base_url\": \"auto\",
    \"p_app_name\": \"$APP\",
    \"p_story_id\": \"$STORY_ID\",
    \"p_suite\": \"e2e/intentionally-broken.spec.ts\",
    \"p_metadata\": {}
  }"
```

Expected (after run finishes):

- `playwright_runs.status = 'failed'`
- `playwright_runs.triggered_rollback_id IS NOT NULL`
- `rollback_history` has a new row with `triggered_by='playwright_staging_auto'`
- `qa_playwright_failed` story_entry
- `audit_journal` has `PLAYWRIGHT_RUN_RESULT` event with `triggered_rollback=true`
- `coolify_app_slots.<active_slot>_health = 'degraded'`

### Cleanup

```bash
# Mark the test story as archived so it doesn't pollute kanban views
curl -X POST "${AISHA_POSTGREST_URL}/rest/v1/rpc/update_story_status_audited" \
  -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" \
  -d "{\"p_status\":\"archived\",\"p_story_id\":\"$STORY_ID\"}"
```

Reports persist in `e2e-reports/<run_id>/` for 30 days by bucket policy.

## When to run the runbook

| Trigger | Cadence |
|---|---|
| After deploying svc-playwright-runner | once after deploy |
| After modifying `WF_DEPLOY_STORY` | once after each change |
| After changing `resolve_deployed_url` or related RPCs | each release |
| Periodic confidence check on staging | monthly |
| Before a production_manual run on a new app | always (preflight) |

## What's intentionally NOT here

- Performance benchmarking (P95 latency, etc.) — that's the runner's
  own `performance.spec.ts` not preflight scope.
- Cross-stack sync (operator-instance Verdaccio mirrors) — that's
  task D of the systemic-completion plan.
- CVE incident response — task E of the plan.

## Gate coverage

`src/tests/gates/playwright-preflight.gate.test.ts` asserts:

- `scripts/playwright-runner-preflight.mjs` exists at the canonical path
- Script accepts `--app-name` argument (required)
- Script accepts `--json` flag for CI integration
- Script invokes the 6 documented checks (RPC names appear in source)
- Script uses argv-form subprocess API (no shell injection surface) —
  actually no subprocesses needed since this script is pure RPC + fetch
- Runbook exists at `docs/stack/playwright-runtime-validation.md`
- Runbook references the preflight script
- Runbook documents the auto-rollback negative test
