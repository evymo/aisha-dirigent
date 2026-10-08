# AISHA surfaces (extranet) — operator runbook

## What this covers

Provisioning and redeploying the instance's **surface SPAs** — the extranet and
any sibling single-purpose front-end — via `scripts/provision-surfaces.sh`.

A *surface* is the generic `deploy/surface-host/Dockerfile` image, built with
`SHELL_APP=<shell>` + `INSTANCE_DIR=instances/<slug>` and served static on
`:8080`. It renders whatever **sections** the backend serves (see
`list_surface_sections`), so adding a section needs no change here.

## Why surfaces are NOT in the manifest

This is the question every operator asks, so it is answered here rather than
rediscovered each time.

**The load-bearing reason is maintenance.** A surface is its own deployable with
its own cadence: a label fix ships without touching the core, the DB or a single
migration, and a broken surface build cannot take the backend down with it —
different container, different lifecycle. Folded into the core compose stack,
every copy change in a mask would cycle migrations and restart the core. Keeping
the blast radius the size of the change is worth one extra mechanism.

The second reason is mechanical. Compose stacks
(`coolify/manifests/aisha.manifest` + `WAVES` in `scripts/aisha-redeploy.mjs`)
deploy a container and nothing else. A surface needs **two** things created
together:

1. a Coolify Dockerfile app on its own FQDN, and
2. a **Keycloak public client** whose `redirectUris`/`webOrigins` match that
   FQDN — a browser SPA cannot log in without one.

Compose cannot create the second. Splitting them would put the container in one
mechanism and its auth client in another, with two places to keep in sync. So
surfaces follow the same convention as `provision-appsmith.sh` /
`provision-intranet.sh`: an operator-run provisioner that reconciles both.

> An older comment in the script justifies this by surfaces living in a separate
> `aisha-multi-surface` repo. **That premise has expired** — the shells and the
> Dockerfile now live in this repo. The reason that still holds is the Keycloak
> client, not the repo split.

Consequence to keep in mind: `aisha-redeploy.mjs --only=extranet` does
**nothing** (surfaces are not in `WAVES`, and the manifest↔WAVES gate asserts
both directions, so they cannot be added there without a compose file). To
redeploy a surface, rerun the provisioner — it is idempotent and triggers the
deploy itself.

## Declaring the surfaces

Opt-in via a CSV of `surface:shell:subdomain` triples. Nothing happens unless it
is set, so the upstream stack and surfaceless instances are unaffected:

```bash
AISHA_SURFACES="extranet:workbench-shell:extra"
```

That yields a Coolify app **and** a Keycloak client named
`<APP_NAME_PREFIX>-extranet` on `extra.<PUBLIC_TLD>`, built from
`apps/workbench-shell` against `instances/<slug>`.

## How to run

Required env (all present in a cold-start environment):
`COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_PROJECT_UUID`,
`APP_NAME_PREFIX`, `PUBLIC_TLD`, `KEYCLOAK_URL`, `KEYCLOAK_ADMIN_PASSWORD`.

Optional:
- `AISHA_SURFACE_REPO` — the repo Coolify builds from. **Defaults to the
  checkout's remote that is the deployed repository** — chosen by URL identity
  from the manifest declaration (`repo:`), never by remote name: in a fork
  checkout `origin` is the upstream, not the repo the instance builds from. The
  shells and `deploy/surface-host/Dockerfile` live here; set it explicitly when
  Coolify needs a token-in-URL clone, or when no remote of the checkout points
  at the deployed repository (the script then stops with the reason).
- `AISHA_SURFACE_BRANCH` (default: the branch the manifest declares — `branch:`,
  else `main`; the surface is built from the same branch as the rest of the
  instance) · `AISHA_INSTANCE_SLUG` (default
  `APP_NAME_PREFIX`) · `KEYCLOAK_REALM` (default `aisha`).

```bash
AISHA_SURFACES="extranet:workbench-shell:extra" bash scripts/provision-surfaces.sh
```

Idempotent: an app or client that already exists is reconciled, not duplicated.

## Verifying a surface after deploy

Deploying the container is not evidence the surface works — measure the chain:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://extra.<PUBLIC_TLD>/
```

Then confirm the backend serves it something. Sections come from the DB, so ask
the DB **with an identity** — an unauthenticated query hits the fail-closed
branch and returns empty, which looks identical to "no data":

```sql
SET LOCAL ROLE service_role;
SELECT * FROM jsonb_to_recordset(public.list_surface_sections())
  AS x(section text, block_count int);
```

Every section listed there becomes a nav tab. A section with zero active blocks
is omitted on purpose — a tab leading nowhere is worse than no tab.

## Known traps

- **`AISHA_SURFACE_BRANCH` must be the instance's deploy branch** (the manifest's
  `branch:`, normally `main` — which is also the default when the variable is
  unset). An app pinned to a different branch keeps deploying that branch, so
  merges to the deploy branch silently never reach the surface. Measured
  2026-07-27: the live extranet tracked
  `feat/<fork>-extranet-surface-host` long after the work had merged.
- **A running container shows the branch it was BUILT from**, not the app's
  current setting. After repointing the branch in Coolify, `docker inspect` still
  reports the old value until the next deploy — do not read that as the fix
  having failed.
- **The redeploy tool cannot reach surfaces** (see above). `--only=extranet`
  exits successfully having done nothing, which reads like success.
- **Cold start does not run this script**, exactly like its sibling
  provisioners. A wiped instance gets its surfaces back only when an operator
  runs it — treat that as a step in the cold-start checklist, not an assumption.
