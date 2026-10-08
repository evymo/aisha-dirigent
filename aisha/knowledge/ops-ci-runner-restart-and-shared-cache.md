---
slug: ops-ci-runner-restart-and-shared-cache
title: "CI runner service: restart only when idle, and shared cache must ask every lane"
summary: "Restarting a Coolify service that hosts Forgejo runners recreates every container and kills running jobs; jobs run inside DinD and are invisible on the host; anything touching a cache shared by two lanes must check both."
category: operations
item_type: playbook
tags: [ci, forgejo-runner, dind, restart, cache, janitor]
verified: read
verified_note: "restart behaviour was measured on 2026-09-27 and 2026-10-03, the janitor defect from runner logs (18 deletions in two days) and its fix by a test that failed 6 of 10 runs before the fix; runner definitions and logs live in a private infrastructure repository (not re-run for this item)"
evidence:
  - "procedure: Coolify API — PATCH /api/v1/services/{uuid} stores docker_compose_raw only; POST /api/v1/services/{uuid}/restart recreates every container of the service"
  - "procedure: idle check = no container named FORGEJO-ACTIONS-TASK-* in ANY DinD of the service (docker exec <dind> docker ps), twice, 20 s apart"
  - "procedure: re-measure rule 4 by running a job in one lane while the other lane's janitor decides; the shared cache must stay"
valid_for: "a runner service with several lanes, each with its own DinD, sharing one cache volume; Coolify 4.x API, verify on your version"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Before restarting or redeploying a CI runner service, wait until no FORGEJO-ACTIONS-TASK container exists in every DinD of the service twice in a row 20 s apart, and announce the window. When CI fails with npm EEXIST or ENOENT under _cacache, suspect the runner, rerun, and check cache janitors."
---
# CI runner service: restart only when idle, and shared cache must ask every lane

## Rules
1. **Saving and restarting are two steps.** [measured] `PATCH /api/v1/services/<uuid>` with `docker_compose_raw` (base64) only stores the compose. `POST …/restart` (POST; GET says the endpoint changed) does `up -d --force-recreate` of ALL containers: runner, DinD and janitor. Running jobs die. `/start` on a running service does nothing.
2. **Compare stored compose semantically.** [measured] Coolify drops trailing whitespace and comments outside strings, so a text diff lies; compare parsed YAML.
3. **Jobs live inside DinD.** [measured] `docker ps` on the host never shows them; use `docker exec <dind> docker ps` for every lane. "Idle" = no `FORGEJO-ACTIONS-TASK-*` in any DinD, twice, 20 s apart. Quiet usually came within ~15 min; after restart all healthy in ~45 s.
4. **A guard that asks only its own lane is no guard.** [measured] Each lane's janitor deleted the shared npm cache when "nobody works", asking only its own DinD. One janitor deleted it 18 times in two days under running jobs of the other lane (`npm error EEXIST`, `ENOENT … _cacache/tmp`, jobs hitting their time limit). Fixed: ask all neighbouring DinD; a neighbour that does not answer counts as working. After the fix: 3 refusals, 0 deletions in 24 h.
5. **A lane that carries deploy jobs makes every restart a deploy decision.** [read] A restart cuts a running deploy wave in the middle.
6. **A runner's queue is not visible as tasks.** [measured] A task exists only after a runner takes the job. "No tasks" is not "quiet": measure `…/actions/runs?status=running&status=waiting&status=blocked` per repository.

## Why
Two outages of CI looked like flaky tests: one was a restart during jobs, the other a cache deleted under running jobs by a guard that could not see the other lane.
