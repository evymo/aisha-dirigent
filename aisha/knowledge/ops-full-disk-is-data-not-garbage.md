---
slug: ops-full-disk-is-data-not-garbage
title: "A full Coolify server: find what grew, not what looks reclaimable"
summary: "On Coolify nodes 'reclaimable' in docker system df is not garbage; space is taken by data volumes, retained images and one-shot init images. Measure growth first, then decide retention with the owner."
category: operations
item_type: playbook
tags: [disk, docker, coolify, retention, cleanup, capacity]
verified: read
verified_note: "rules 1-4 and 7 were measured read-only on four Coolify nodes between 2026-09-23 and 2026-10-03, rule 6 comes from two outages, rule 5 is reading; the node surveys are not public (not re-run for this item)"
evidence:
  - "procedure: docker system df -v, then per volume docker exec <container> find <path> -type f -mtime -N -exec du -k {} + ; Coolify DB table docker_cleanup_executions for the cleanup history over a whole window"
  - "procedure: compare journalctl --disk-usage (user journal only without root) with du -sh /var/log/journal"
  - "file: docker-compose.coolify.yml — one-shot services (pki-init, migrate) whose current images look reclaimable after their containers finish"
valid_for: "Coolify 4.x; verify on your version"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When asked why a server is full or whether it can be cleaned, answer with this structure: what grew (per volume, per day), who pulled or wrote it, what retention keeps on purpose, and which owner decision would free space. Never propose deleting images or volumes only because Docker calls them reclaimable."
---
# A full Coolify server: find what grew, not what looks reclaimable

## Rules
1. **"Reclaimable" means "no container uses it", not "safe to delete".** [measured] On a deployment node ~35 GB of reclaimable images were the current images of one-shot services (`pki-init`, `migrate`, `n8n-workflow-init`, `plugin-publish-init`). Their containers finished and were cleaned up; the next deploy needs them, and locally built ones cannot be pulled back.
2. **Orphans are usually absent.** [measured] Every image uuid prefix on three nodes matched a live Coolify resource. Hunting for garbage is a dead end; space is data and retention.
3. **Measure growth first.** [measured] `docker exec <c> find <path> -type f -mtime -N -exec du -k {} +` per volume, then the logs of whatever writes there. A 20 GB jump on a registry node came from one large image pulled through the pull-through cache, not from CI (CI logs grew ~30 MB/day).
4. **Coolify cleanup works in a saw-tooth.** [measured] Above the threshold (80 %) the forced cleanup runs hourly and frees space each time; the last two or three log lines ("93 % -> 93 %") are a sample, not the whole. Count over the full window.
5. **The real levers are owner decisions.** [read] `docker_images_to_keep` per application, deleting retired (stopped) applications, retention of the npm registry, moving a static database. None is a cleanup step an agent should take alone.
6. **Deploying a whole instance at once does not fit the reserve.** [measured] A cold start that redeployed every stack of one instance in parallel filled a 120 GB node (ENOSPC, cascade of failed layers). Deploy stacks one by one on tight nodes.
7. **Without root, journal size lies.** [measured] `journalctl --disk-usage` shows only the user journal (24 MB) while `/var/log/journal` held 4.1 GB. Measure with `du -sh /var/log/journal`; a cap (`SystemMaxUse=1G`) keeps it bounded.

## Why
Twice an agent almost reported findings that were not true (ineffective cleanup, orphaned journal) and once an "obsolete" image deletion broke a deploy. The answer to "the disk is full" is capacity and retention, decided by the owner.
