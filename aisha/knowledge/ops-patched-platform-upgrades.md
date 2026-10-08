---
slug: ops-patched-platform-upgrades
title: "A locally patched control plane: no auto-update, patch lives in config, verify by running"
summary: "When the deployment platform carries a local patch, automatic updates must be off, the patch must live in the config applied at container creation (not in the running container), and every claim about it is verified by a real deploy."
category: operations
item_type: playbook
tags: [coolify, patch, upgrade, auto-update, configuration-drift]
verified: read
verified_note: "rules 1-4 and 7 come from incidents on a control plane carrying a source patch (an automatic update that failed every deploy, a runtime edit nearly lost, wrong conclusions reversed only by a real deploy); the records are not public (not re-run for this item)"
evidence:
  - "procedure: Coolify instance_settings.is_auto_update_enabled must read false on a patched control plane"
  - "procedure: drift check = stat -c %y <patched file> inside the container vs docker inspect -f '{{.State.StartedAt}}' <container>; a file newer than the start was edited in place"
  - "procedure: docker compose up -d --no-deps --force-recreate <service> --dry-run before the real recreate; the patch install log must say 'applied to N file(s)' without warning"
valid_for: "general for any control plane carrying a local patch; examples from Coolify 4.x with a compose-mounted source patch"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Never enable automatic updates of a patched control plane. Before any upgrade: rebase the patch on the new version, install through the compose config, recreate only the service, verify the apply log. Check whether files were edited inside the running container (mtime vs StartedAt) before recreating it."
---
# A locally patched control plane

## Rules
1. **Auto-update off.** [measured] A midnight update to a new patch release broke one hunk of the patch; 100 % of deploys of ~200 applications failed until the patch was rewritten. The update also killed workers of two running deploys, which stayed `in_progress` forever (no reaper).
2. **Upgrade order:** [measured] rebase the patch on a clean tree from the new image (`git apply --reject`, finish rejected hunks, `php -l` all files, apply to a clean tree) -> install through the compose override file -> recreate only the service (`up -d --no-deps --force-recreate <service>`, always `--dry-run` first; without `--no-deps` compose recreates DB, redis and realtime) -> the log must say "applied to N file(s)" without warning.
3. **Before recreate, zero deploys in progress,** [measured] otherwise they are orphaned.
4. **The patch lives in config, not in the container.** [measured] Files are copied at container creation; `docker restart` does not deliver a new patch and an edit inside the running container vanishes at the next recreate. Detect drift: `stat -c %y` of a patched file vs. container `State.StartedAt`; capture drift as a patch before recreating.
5. **One authority.** [read] The patch has one source of truth (the main branch of the repository that holds it); a new version is a commit there, then install in a window. Read the log of the patch directory before writing a new version: other operators write it too.
6. **Parts of one fix stay in one file.** [read] If two dependent parts of a patch live separately, an upgrade can drop one and leave a worse state than unpatched (variables suddenly 'required but missing').
7. **Static reading and foreign reports are not evidence here.** [measured] The conclusion "build server does not work with compose" was reversed several times by reading code and a public discussion; only a deploy that passed the first gate decided it.
8. **Self-approval is blocked.** [read] The operator who writes a patch PR does not merge it; root install steps are prepared as commands for the owner.
