# Story Self-Evaluation Loop — Verification Runbook

> Companion to [STORY_SELF_EVALUATION_LOOP.md](STORY_SELF_EVALUATION_LOOP.md).
> How to verify the self-* loop is **functional + deployed + verifiable in production**,
> via containerized Playwright E2E against the deployed stack (or a local stack).

## Verification layers (what proves what)

| Layer | Tool | Proves | Where |
|---|---|---|---|
| **Static / unit** | `npm run test:gates`, `validate:static`, `tsc`, `lint`, `test:run` | Contracts, structure, advisory-only invariants, SQL syntax, no-regression | local + `db-cold-start-apply` CI |
| **Cold-start apply** | `db-cold-start-apply` CI job | Baseline (incl. self-eval view/RPCs/column) **applies** to a fresh canonical PG17 — real `CREATE VIEW`/function validation | CI |
| **Deployed runtime** ⭐ | **`e2e/self-eval-loop.spec.ts`** via `svc-playwright-runner` | RPCs/endpoints actually **run** on the live stack (verdict returns, lister callable, dispatch responds, outcome column present) | container → prod / local stack |
| **Live loop** | n8n executions + Appsmith Ops dashboard | Playbooks fire, proposals flow, outcomes recorded | prod, post-merge |

## The E2E spec — `e2e/self-eval-loop.spec.ts`

Runs from the `svc-playwright-runner` container against `PLAYWRIGHT_BASE_URL` (the deployed
target). Authenticates as **service_role** via `POSTGREST_SERVICE_TOKEN` (same as n8n). Asserts:

1. `evaluate_story_self(story_id)` → 200 + well-formed verdict (`score`/`level`/`dimensions`/`findings`/`recommended_actions`) — **PR1 deployed**
2. `get_story_aisha_maturity(story_id)` → 200 + scorecard — **PR1 maturity fix deployed**
3. `fn_get_proposals_due_outcome_review()` → 200 + array — **PR5 loop-closer deployed**
4. `improvement_proposals?select=outcome` → 200 — **PR5 migration applied**
5. `POST /dirigent/dispatch` → handled (not 404/5xx) — **PR2 supervisor edge fn deployed**

Story is resolved from `E2E_STORY_ID` or the stack-default story (`partner_stories.is_stack_default`).
The suite **skips cleanly** when no service token / target is configured — it never false-fails;
it only asserts when pointed at a real stack.

## Run it

### Against the deployed stack (production / staging) — the canonical path
Enqueue a run; the runner picks it up, executes against the resolved slot URL, records the result
(→ `playwright_runs`, story timeline `qa_playwright_*`, B/G slot health, auto-rollback on staging fail):

```bash
# production_manual (requires admin token + a second-admin approval)
curl -X POST "$AISHA_GATEWAY_URL/rest/v1/rpc/start_playwright_run" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{ "p_trigger_kind":"production_manual", "p_target_env":"production",
        "p_target_base_url":"auto", "p_app_name":"aisha-core",
        "p_suite":"e2e/self-eval-loop.spec.ts", "p_story_id":"<stack-default-story-uuid>" }'
# then a different admin:
#   start_playwright_run returns a run id → approve_playwright_run(p_run_id => '<id>')
```

`p_target_base_url:"auto"` → `resolve_deployed_url(app_name)` resolves the live blue/green slot.

### Against a local stack
```bash
# point the spec at the local stack + provide the local service token
E2E_BASE_URL=http://127.0.0.1:8080 \
AISHA_GATEWAY_URL=http://127.0.0.1:3001 \
POSTGREST_SERVICE_TOKEN=$LOCAL_SERVICE_TOKEN \
E2E_SKIP_SERVER=1 \
  npx playwright test e2e/self-eval-loop.spec.ts
```

### Quick reachability sanity (no Playwright)
```bash
curl -s -X POST "$RPC_BASE/rest/v1/rpc/evaluate_story_self" \
  -H "Authorization: Bearer $POSTGREST_SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"p_story_id":"<uuid>"}' | jq '.score,.level,.findings'
```

## Read the results
```sql
-- the run + counts + linked story / rollback
SELECT id, trigger_kind, target_env, status, total, passed, failed,
       report_storage_path, story_id, triggered_rollback_id
FROM playwright_runs ORDER BY created_at DESC LIMIT 5;

-- story timeline entries emitted by the run
SELECT entry_type, content, created_at FROM story_entries
WHERE story_id = '<uuid>' AND entry_type LIKE 'qa_playwright_%' ORDER BY created_at DESC;
```
- `status='passed'` → the deployed self-eval loop is functional on the target.
- `status='failed'` on `staging_auto` → `request_rollback` auto-fires (gated); inspect `triggered_rollback_id`.
- HTML report: storage bucket `e2e-reports/<run_id>/html/index.html` (admin/staff).

## Notes
- UI/browser E2E of the verdict surfaces (workbench panel, Appsmith Ops) lands with **PR 6** —
  add browser specs to this file then.
- Local dev DB may be **stale** (missing recent tables/columns); it is NOT a faithful substrate —
  use a cold-start applied DB or the deployed stack for runtime verification.
