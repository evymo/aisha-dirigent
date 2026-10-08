---
slug: ops-coolify-deploy-facts
title: "Coolify deployments: timing, start order of an instance, where it builds"
summary: "Deployment duration comes from log timestamps, not from the queue table; an instance starts PKI first; the build location is the helper container named by the deployment uuid, not a DB column."
category: operations
item_type: engineering_doc
tags: [coolify, deploy, pki, start-order, build-server, measurement]
verified: read
verified_note: "timing error found 2026-09-13 against log timestamps; start-order failure reproduced 2026-09-02; build location measured during a live deploy; the measurements were made on a production Coolify and are not public (not re-run for this item)"
evidence:
  - "file: docker-compose.coolify-pki.yml — the per-instance PKI stack every other stack waits for"
  - "file: docker-compose.coolify.yml — a stack with its own pki-init service (every AISHA stack carries one)"
  - "procedure: compare application_deployment_queues.updated_at with the first and last logs[].timestamp of the same deployment"
valid_for: "Coolify 4.x with AISHA stacks (pki-init in every stack); verify on your version"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Before concluding anything about overlap, order or duration of deployments, read first and last timestamp from the deployment logs. Before a mass restart of an instance, start <instance>-pki alone and wait for healthy. Trust docker ps -a on the target server over the status column in the Coolify DB."
---
# Coolify deployments: timing, start order, where it builds

## Rules
1. **`updated_at` is not the end of a deploy.** [measured] It changes long after (bulk status rewrites, cleanup). A 13-minute "overlap" derived from it did not exist; log timestamps showed sequential deploys. A patch built on that reading was useless and harmful and had to be reverted.
2. **Real run = first and last `timestamp` in the JSON `logs` field** (UTC ISO). Queue times are orientation only.
3. **An instance starts PKI first.** [measured] Every stack has `pki-init`, which waits for the instance's `pki-bridge` to issue the realm CA and gives up after 600 s with exit 1 (`service "pki-init" didn't complete successfully`). Order: `<instance>-pki` -> wait for `pki-bridge`, `pki-auth`, `pki-server`, `pki-db` healthy -> the rest.
4. **PKI stacks are per instance.** [read] A `pki-bridge` on another server belongs to another instance; instances never share PKI.
5. **The DB status column lags.** [measured] `applications.status` is updated periodically; reality is `docker ps -a` on the target server.
6. **Where it builds = the helper container named by `deployment_uuid`.** [measured] Load on the build node during a deploy came from the CI runner (a push triggers both CI and the deploy), while the Coolify helper ran on the target host. Check whether `build_server_id` in the DB is filled on your version before relying on it: in the measured version `addLogEntry()` → `refresh()` discarded it (833 of 833 rows were NULL).
7. **Cancelling a deploy can leave a helper behind** [measured] with its `build-time.env` on the build node, because cancellation removes the helper on `build_server_id ?? server_id`.
8. **Never run several deploys of one application in parallel; prefer one stack at a time on tight nodes.** [read: recommendation derived from an out-of-disk outage during a parallel deploy]

## Why
Each rule replaced a wrong conclusion that looked like an infrastructure fault.
