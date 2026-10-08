# Multi-instance isolation — standing up a new standalone project

How to bring up a **new standalone AISHA instance** (its own implementation, own
domain, own realm, own data) that cold-starts, deploys and `--wipe`s **fully
independently** of every other instance — no cross-instance overwrite.

## The two isolation planes (why this needs care)

A 56-agent collision audit (2026-07) confirmed the shared-resource surface
splits into **two planes with different boundaries**:

| Plane | What lives here | Isolation boundary |
|---|---|---|
| **Control** | Coolify app records, `--wipe` enumeration, story-init reconcile/rebind | Coolify **project** (+ the app-name regex) |
| **Data** | Docker DNS aliases (`aisha-db`, `aisha-shared-redis`, `gateway`), named volumes (`aisha_v2_db-data`, `aisha_shared-redis-data`, `aisha_appsmith-data-v3`) | Docker **network + daemon** |

The data-plane names are **intentionally `aisha-*` regardless of story** (see
`CLAUDE.md`), and every `docker-compose.coolify*.yml` attaches to one
**server-wide flat network** (`external: true; name: coolify` — cold-start even
*patches* apps onto it). So **two full stacks on the same Docker daemon collide
no matter what you name the Coolify apps or project** (their `aisha-db` aliases
round-robin; their `aisha_v2_db-data` volumes are shared).

## The model: one server + one project per instance

**Recommended (and only fully-isolated) model:**

1. **One Coolify SERVER per instance** — own Docker daemon ⇒ own `coolify`
   network ⇒ own `aisha_*` volume namespace. This is what neutralizes the
   data-plane collisions. (Separate *project* on a *shared* server does **not**
   isolate the data plane.)
2. **One Coolify PROJECT per instance** on that server — scopes the control
   plane (story-init lists/creates and `--wipe` enumerates per project, so
   nothing rebinds or deletes a co-tenant).
3. **Code guardrails** (shipped) close the global-endpoint back-doors so a
   single Coolify control plane can't reach across projects/servers:
   - **`scripts/lib/coolify-project-scope.mjs` (the PRIMARY boundary)** — the
     mutating/destructive orchestration scripts (`coolify-wipe-all.mjs`,
     `coolify-deploy-init.sh`, …) confine every read AND write to the declared
     project's `environment_id`s and **fail loud** without `COOLIFY_PROJECT_UUID`
     (no global-name fallback). Name prefixes are only a secondary belt-and-braces
     filter *within* the project.
   - `--story` beats the manifest `story:` (`coolify-story-init.sh`) and
     cold-start passes `--story "${APP_NAME_PREFIX}"`, so a fork *can* name apps
     `<instance>-*` from a generic manifest (complements the project scope).
   - Cold-start's own `wipe_orphan_apps` lists project-scoped
     (`/projects/{uuid}/{env}`), never silently widens to the global
     `GET /applications` when `COOLIFY_PROJECT_UUID` is set, and its wipe regex is
     strictly `^${APP_NAME_PREFIX}-` for a named instance (legacy `aisha-`/`evymo-`/
     `n8n` cleanup only for the `aisha` default, or `AISHA_WIPE_INCLUDE_LEGACY=1`).

Keep the internal `aisha-*` names + the **generic `aisha.manifest`** — with a
server boundary they never touch another instance's data plane, and the fork
stays upstream-clean (the boundary gate forbids tenant-named manifests). A
per-instance `APP_NAME_PREFIX` is **optional control-plane defense-in-depth**.

> **Same-server co-location** of two full instances is *not* isolated until the
> data plane (network name + every shared volume `name:` + container names +
> cross-stack aliases across ~23 compose files) is also parameterized. That is a
> deliberate **separate iteration** — not required by this model. Ask for it
> explicitly if you must co-locate.

## Stand up a new instance (one command + operator prereqs)

```bash
# 1. In a FRESH clone of the fork (one checkout per instance):
bash scripts/init-new-tenant.sh \
  --instance=acme \
  --base-domain=acme.example \
  --keycloak-domain=auth.acme.example \
  --coolify-project-uuid=<acme's own Coolify project uuid> \
  --coolify-server-uuid=<acme's own Coolify server uuid> \
  --coolify-environment=production
# → writes config/tenant.env (AISHA_INSTANCE=acme), config/domains-acme.env
#   (with Coolify targeting + a commented APP_NAME_PREFIX), keycloak/acme-realm.json.

# 2. Create the acme-instance-data + acme-web private repos (KB, web, operators).
# 3. Set operator secrets in Coolify env / .env-prod-backup (NEVER committed):
#      COOLIFY_API_TOKEN, GIT_TOKEN / GITHUB_TOKEN, SOURCE_* (if federated),
#      AISHA_PRIMARY_ADMIN_EMAIL, and the Coolify project/server UUIDs.
# 4. git commit; then on the deploy host:
AISHA_PRIMARY_ADMIN_EMAIL=... bash scripts/aisha-cold-start.sh --wipe
# 5. Verify: scripts/cold-start-verify.mjs (green = truly 100%).
```

**Operator-supplied (never committed):** the Coolify **server + project creation
itself** (the two isolation boundaries), `COOLIFY_API_TOKEN`, `GIT_TOKEN` / `GITHUB_TOKEN`,
`SOURCE_*` secrets, `AISHA_PRIMARY_ADMIN_EMAIL`, and the UUIDs.

## Guarantee

With a separate Coolify **server + project per instance** and the shipped
guardrails, each instance's `cold-start` and `--wipe` provably enumerate and
mutate **only their own project on their own Docker daemon** — two instances
stand up and tear down fully independently. Co-locating two instances on **one
server** does *not* hold this guarantee until the data-plane iteration lands.
