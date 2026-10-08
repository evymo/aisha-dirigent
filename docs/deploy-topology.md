# Deploy topology — which app serves what, and how to verify it

Written 2026-07-29 after a day in which four separate green signals each measured
something other than what we believed. The point of this document is that the
next person can answer two questions without re-deriving them:

1. **Which application serves this URL?**
2. **Is what runs there actually the code we merged?**

## One instance = many Coolify applications

An instance is not one app. Every stack in `ALL_STACKS`
(`scripts/coolify-deploy-init.sh`) is its own Coolify application, named
`<prefix>-<role>` where the prefix is the instance's
(`APP_NAME_PREFIX`/`AISHA_STORY`).

Concretely, deploying "the core" does **not** deploy the customer surface:

| application | serves |
|---|---|
| `<prefix>-core` | database, PostgREST, gateway, storage |
| `<prefix>-edge` | public ingress — fronts every public hostname |
| `<prefix>-extranet` | the customer surface (workbench shell) |
| `<prefix>-keycloak` | identity |

**Never hardcode the prefix.** `coolify-deploy-init.sh` says why in its own
comment: a fork that did not set `APP_NAME_PREFIX` would discover and mutate the
UPSTREAM `aisha-*` apps. Measured 2026-07-29: `.github/workflows/ci.yml` had
`aisha-core` hardcoded, so this fork's pipeline deployed another instance's stack
and never once deployed its own.

The name is INSTANCE DATA. CI derives it from the single overlay under
`instances/`, and **fails** when it cannot — a checkout that does not know which
instance it deploys must not guess.

## Public hostnames go through edge

`public = edge` is the routing rule. A stack does not carry its own public
Traefik router; it answers on the internal zone and edge fronts the public host:

```
config/services.json           subdomain + public + tier
scripts/lib/derive-domains.mjs emits <NAME>_DOMAIN_PUBLIC / <NAME>_UPSTREAM_PUBLIC
docker-compose.coolify-prebuilt.yml   edge Caddy route + Traefik router
scripts/coolify-deploy-init.sh set_coolify_env_if → hands them to the edge app
```

Optional stacks are guarded at every step (`if (topo.services.x)`, empty-block
injection), so a profile that ships without them emits nothing rather than
crashing Caddy.

Until 2026-07-29 the extranet carried `extra.<tld>` on its own labels and
bypassed edge entirely.

## A stack must be registered everywhere, or nothing watches it

The extranet existed in Coolify for weeks while appearing in **no** registry. The
consequence was not an error — it was silence. Nothing deployed it, so it sat on
a commit from the previous night while three PRs merged past it, and every gate
stayed green because no gate knew it should exist.

Registering a stack means all of these, in one change:

| file | what it learns |
|---|---|
| `config/services.json` | subdomain, tier, compose, placement |
| `scripts/coolify-deploy-init.sh` | `ALL_STACKS`, compose, label, app name, UUID |
| `scripts/aisha-cold-start.sh` | `STACKS`, UUID resolve, HEREDOC env keys |
| `scripts/aisha-redeploy.mjs` | redeploy waves |
| `coolify/manifests/aisha.manifest` | `app:` line (WAVES parity gate) |
| `scripts/lib/derive-domains.mjs` | public face, guarded |
| `docker-compose.coolify-prebuilt.yml` | edge route |
| `.github/workflows/ci.yml` | a Deploy job |

Two gates enforce parts of this and both caught a real omission while this was
being written: `redeploy-wave-coverage` (WAVES ↔ manifest parity) and
`env-doctor-contract-coverage` (every required compose var must be generated).

## Verifying a deploy

**Not by the colour of a CI job.** Measured the same day:

- `Deploy: Web` called Coolify `/restart`, which re-runs the container on the
  image it ALREADY has. The job went green, the container was genuinely
  recreated with a fresh `CreatedAt` — and the image tag was still the previous
  commit. Everything looked deployed except the artifact.
- Two branches of the same job ended `exit 0` in silence (missing token, unknown
  UUID), so a job that deployed nothing reported success.

The image tag IS the commit. Check the artifact:

```bash
# what is actually running
ssh <host> 'docker ps --format "{{.Image}}"' | grep _extranet

# what the browser actually receives
curl -s https://extra.<tld>/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

A deploy is verified when the image tag matches the merge commit **and** the
served bundle changed. Anything else is a report about a process, not a fact
about production.
