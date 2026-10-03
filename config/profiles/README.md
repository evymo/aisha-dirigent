# Deployment profiles

A profile describes the **shape** of a deployment: which server slots exist, how
internal and public hostnames are patterned, whether mesh is on, which service
tiers are included.

## What lives here

**Templates only.** `cloud-multi`, `cloud-single`, `local-dev` — the shapes a
deployment can take. They name no tenant, no domain of a real operator, no
server, and no organization.

This repository is public. A profile that carries a live deployment's domains,
its Coolify server names, or the organization that runs it is **instance data**,
and instance data does not belong in a public repository — no matter how
convenient it is to keep it next to the templates.

## Where an instance profile lives

In the instance's own private overlay, alongside the rest of its data:

```
<instance-data repo>/
  profiles/<id>.json      ← this instance's profile
  operators.json          ← operator roster (already loaded this way)
  aisha-config/brand.json ← brand identity
```

## How it gets here

Through the same channel as everything else instance-specific.

**Resolution.** `scripts/lib/derive-domains.mjs` resolves `AISHA_PROFILE`
against `AISHA_INSTANCE_CONFIG_DIR` (read only through
`scripts/lib/instance-overlay.mjs`). Whether a template here may stand in
depends on whether the instance **declares** an overlay:

- **No declaration** (`AISHA_INSTANCE_DATA_GIT_URL` empty) — a community
  install. It runs on a template here, which is what these files are for.
- **Declared** (`AISHA_INSTANCE_DATA_GIT_URL` set in the environment or in the
  target `.env.coolify`) — the overlay is **required**. Without
  `AISHA_INSTANCE_CONFIG_DIR` pointing at a checkout of that repository, the
  resolver, `aisha-env-doctor` and therefore `aisha-redeploy` refuse to derive
  anything. A template is not "less data" for such an instance; it is another
  instance's profile. Measured 2026-09-13: a redeploy without the overlay
  derived `SPA_DIAGNOSE=1` from the template and took the knock service down,
  and nothing failed. The gate `deklarovany-overlay-je-povinny` pins this.

**Who provides the path.** `aisha-cold-start.sh` clones the declared overlay
before the topology resolver runs and exports the checkout; if the clone fails it
stops instead of continuing on templates. Every other entry point
(`aisha-redeploy.mjs`, `aisha-env-doctor.mjs`, `derive-domains.mjs` run by hand)
takes `AISHA_INSTANCE_CONFIG_DIR` from the operator's environment.

## Adding a profile

To add a **template** (a new deployment shape everyone can use), add it here.

To configure **your** deployment, put the profile in your overlay repo. If you
find yourself editing a file in this directory to make your own install work,
that is the signal it belongs in the overlay instead.

## Deploy pacing: `deploy_concurrency`

How many deployments `aisha-redeploy.mjs` may have in flight at once, counted
from the trigger until Coolify reports a terminal state (finished / failed /
cancelled). **Absent = 1, i.e. serial.** An unreadable profile or an invalid value
(0, text, a fraction) stops the run with exit 2 instead of silently falling back.

Serial is the default because concurrent redeploys pull and build images on the
same node at the same time; eight at once filled a shared host's disk to 100 %
(ENOSPC) on 2026-09-24. Raise it only where the nodes can hold the images of
several stacks at once — the disk gate still checks every single start.

The disk gate measures the node Coolify deploys to (`destination.server.name`)
over SSH, read-only. The SSH target per node is declared in the vault, not in
the profile, because it is an operator credential rather than a deployment shape:

    AISHA_NODE_SSH="node-a=deploy@node-a.internal,node-b=ops@node-b.internal"

A node without an entry is deployed **unmeasured** and the run reports it (exit 3,
not clean). A declared node whose measurement fails stops the run.
