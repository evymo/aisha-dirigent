---
slug: ops-ci-run-states-and-forgejo-api
title: "Reading CI state correctly: unmeasured runs, cancellation and the Forgejo API"
summary: "A test run has three outcomes (pass, fail, unmeasured); always() jobs do not survive cancellation; the Forgejo API can cancel and dispatch but cannot rerun; run listings are heavy and tasks are not the queue."
category: operations
item_type: engineering_doc
tags: [ci, forgejo, actions-api, verdict, cancellation, flaky]
verified: read
verified_note: "API behaviour was measured on 2026-10-03 against a Forgejo 16.x instance (its swagger and the history of five cancelled runs; not re-run for this item); examples of rules 1, 3 and 5 in code: see evidence"
evidence:
  - "file: scripts/ci/ci-verdikt.mjs — example: finds the run by head_sha instead of listing tasks and reads its jobs through the run id"
  - "file: scripts/test/run-vitest.mjs — example: exit 75 = EX_TEMPFAIL = unmeasured"
  - "file: docs/testing/BRANY_DRAHY_A_VYBER.md"
  - "procedure: Forgejo /swagger.v1.json lists POST /repos/{owner}/{repo}/actions/runs/{run}/cancel and POST …/actions/workflows/{workflow}/dispatches, and no rerun endpoint"
valid_for: "Forgejo 16.x Actions; re-check the API list after a Forgejo upgrade"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "On exit code 75 rerun instead of fixing gates; on 'finding is persistent' fix the code. Do not cancel or dispatch runs without the owner's yes; they are writes."
---
# Reading CI state correctly

## Rules
1. **Three outcomes of a test run.** [measured] `0` measured and green, `1` measured and failed, `75` UNMEASURED (no evidence left: watchdog, sleeping machine, OOM). 75 means rerun (with fewer workers under load); a finding seen in both attempts is "persistent" and rerunning will not help.
2. **`if: always()` does not survive cancellation.** [measured] The server marks every unfinished job cancelled, including waiting ones, before the condition is evaluated; applies to `cancel-in-progress` and manual cancel. A verdict status left `pending` after a cancelled deploy is fail-closed by design.
3. **API capabilities.** [measured] Cancel `POST /repos/{o}/{r}/actions/runs/{run_id}/cancel`; dispatch `POST …/actions/workflows/{file}/dispatches`; jobs `GET …/runs/{run_id}/jobs` returns an ARRAY; no rerun endpoint. `run_id` is the field `id`, not the number shown in the UI (`index_in_repo`).
4. **`task_id = 0`** [measured] means a runner never got the job (it waited on `needs`).
5. **Do not use `/actions/tasks`.** [measured] It times out (504 after 30 s) and loads the forge. Run listings carry the full `event_payload` (30 runs ≈ 30 MB): page with small limits or filter by `head_sha`.
6. **`stopped` is not the cancel time** [measured] (15 min earlier than `context canceled` in the job log). A secret's `created_at` is its creation, not its last change.
7. **PR CI runs from the branch head, not from the merge with main.** [read] A fix already in main does not help a branch that does not contain it.

## Why
Each misreading cost a night: a run that cannot be retried via API stood until morning, and "nothing runs" was concluded from tasks while seven runs waited in the queue.
