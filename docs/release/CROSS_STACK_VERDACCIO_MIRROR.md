# Cross-stack Verdaccio mirror — operator runbook

> **Status:** wired (2026-05-19).
> **Audience:** AISHA platform operators running per-stack instances (the
> upstream Aisha stack, partner tenants, accounting offices, etc.).
> **Purpose:** every operator instance pulls fresh `@aisha/*` from the hub
> registry (`npm.example.com`) without manual sync, using Verdaccio's native
> uplink pattern. Closes task D of the post-#100/#105 systemic plan.

## Why this exists

The hub repo's auto-publish workflow ([`AISHA_PACKAGES_PUBLISH.md`](AISHA_PACKAGES_PUBLISH.md))
keeps `npm.example.com` in sync with `packages/`. But operator instances have
**their own Verdaccio** running locally — for air-gappable deployments
and low-latency installs. Without cross-stack sync, those local
registries drift behind the hub and operator services start installing
stale code (the exact `feedback_supabase_banned`-era pain that caused
PR #73's failure mode).

The right systemic answer (per the user's "vše systémově bez
workaroundů" directive) is **NOT** to fan-out publish from the hub CI —
that requires managing N Verdaccio tokens and N network reachability
guarantees. The right answer is **Verdaccio's native uplink pattern**:
each operator's local Verdaccio is configured to proxy `@aisha/*`
requests through to the hub, caching responses locally. When a service
installs `@aisha/security`:

```
npm install @aisha/security  (in operator service)
        │
        ▼
local Verdaccio (per-stack instance)
        │
        ├─ Has @aisha/security@latest in cache?  → serve from cache
        └─ No?  → proxy npm.example.com, cache response, serve
```

The hub is the single source of truth. Operator instances are
read-through caches. New version published on hub → operator gets it
on next install. Zero manual sync.

## What lands in this PR

| File | Purpose |
|---|---|
| `config/verdaccio/per-stack-uplink.yaml.tpl` | Verdaccio config template with `{{TOKEN}}` placeholder |
| `scripts/render-per-stack-verdaccio-config.mjs` | Renderer — substitutes env vars into template, writes mode 0600 |
| `src/tests/gates/cross-stack-verdaccio-uplink.gate.test.ts` | Asserts template + renderer exist + structurally correct |
| `docs/release/CROSS_STACK_VERDACCIO_MIRROR.md` | This runbook |

## Initial setup (one-time per operator instance)

### 1. Provision a hub token for this operator

The hub admin (`npm.example.com` super-user) creates a **read-scope** token
that only this operator instance uses:

```bash
# On the hub-admin machine
npm adduser --registry https://npm.example.com/
# → username: operator-stack-aisha (or similar per operator)
# → role: read-only

# Or via API if hub admin RPC exists
# Token ends up in ~/.npmrc; copy the //npm.example.com/:_authToken=... line
```

### 2. Deploy per-stack Verdaccio container

The operator's stack already runs Verdaccio (mentioned in `docs/AUTONOMY_PLAN.md`
section A1). Make sure:

- The container has access to the host filesystem at `/verdaccio/storage/`
- Coolify Traefik routes `npm.<operator-domain>` → container port 4873
- TLS is configured (per the existing per-stack mesh pattern)

### 3. Render the config

```bash
export AISHA_HUB_VERDACCIO_TOKEN=<token-from-step-1>

# Optional: override defaults
# export VERDACCIO_STORAGE_PATH=/verdaccio/storage/data
# export VERDACCIO_HTPASSWD_PATH=/verdaccio/storage/htpasswd
# export VERDACCIO_LISTEN_PORT=4873

# Render
node scripts/render-per-stack-verdaccio-config.mjs --out /etc/verdaccio/config.yaml
```

Output:

```
✓ wrote 73 lines to /etc/verdaccio/config.yaml (mode 0600)
```

### 4. Restart Verdaccio container

```bash
docker compose -f docker-compose.coolify-verdaccio.yml restart verdaccio
# Or via Coolify UI: stop + start the Verdaccio service
```

### 5. Verify uplink works

```bash
# Without local cache, this should pull from npm.example.com via the uplink:
curl -fsSL https://npm.<operator-domain>/@aisha%2fsecurity \
  | jq '."dist-tags".latest'
# Expected: same version as npm.example.com reports for @aisha/security
```

The first request goes to the hub; subsequent requests are served from
the local cache.

## How auto-publish + cross-stack sync compose

Hub side (in the orchestrator repo):

```
merge to main (paths: packages/**)
      │
      ▼
.github/workflows/aisha-packages-publish.yml   (opt-in: vars.VERDACCIO_URL)
      │
      ▼
npm publish to the hub Verdaccio (VERDACCIO_URL)
```

Operator side (per-stack instance):

```
service does `npm install @aisha/security`
      │
      ▼
local Verdaccio: cache miss
      │
      ▼
proxy https://npm.example.com/@aisha%2fsecurity (via uplink, with read token)
      │
      ▼
hub returns the latest tarball
      │
      ▼
local Verdaccio caches it + serves to the npm client
```

**Latency**: 1 request × ~300ms for the first install on each operator
instance per new version. All subsequent installs are local (~5ms).

**Air-gap**: if the operator instance loses connectivity to the hub, the
local cache continues serving the LAST-PULLED version. Operators can also
pre-warm the cache before going offline.

## Failure modes & remediation

| Symptom | Likely cause | Fix |
|---|---|---|
| `404 @aisha/security` on operator service install | Local Verdaccio config wasn't rendered, or container wasn't restarted | Re-run renderer + restart container |
| `401 unauthorized` in Verdaccio logs when pulling from uplink | `AISHA_HUB_VERDACCIO_TOKEN` invalid or revoked | Hub admin re-issues, operator re-renders config |
| Operator install returns OLD version of `@aisha/security` | Cache hit on local Verdaccio — package re-published with same version, hub didn't bump | Operator: `curl -X DELETE https://npm.<op>/-/package/@aisha%2fsecurity/dist-tags/latest` to flush, then re-install |
| `connect ETIMEDOUT npm.example.com:443` | Network partition or hub down | Local Verdaccio continues to serve cached versions; verify hub health, then re-deploy operator service |
| Operator service installs a yanked CVE-affected version | Hub yanked but local cache still has it | Operator must flush: `npm cache clean --force && verdaccio --rm-tarball ...` (see Verdaccio docs); or wait for cache TTL |

## Gate coverage

`src/tests/gates/cross-stack-verdaccio-uplink.gate.test.ts` asserts:

- Template file exists at the canonical path
- Template references `@aisha/*` packages section with `proxy: aisha-hub`
- Template uses `bearer` auth type for the uplink (not URL-embedded credentials)
- Template binds `0.0.0.0` (so container is reachable via Coolify Traefik)
- All four required placeholders present: `{{AISHA_HUB_VERDACCIO_TOKEN}}`, `{{STORAGE_PATH}}`, `{{HTPASSWD_PATH}}`, `{{LISTEN_PORT}}`
- Renderer script exists, accepts `--out` (required) + `--dry-run`, refuses to write without `AISHA_HUB_VERDACCIO_TOKEN`
- Renderer writes mode 0600 (per `feedback_no_infra_in_repo` — token-bearing config never world-readable)
- This runbook ships beside the template + references the renderer + documents the failure modes

## Out of scope (explicit)

- **Air-gap snapshots** — exporting + importing a Verdaccio cache between
  disconnected operator instances. That's a Verdaccio-native feature
  (`verdaccio-storage-export`) and orthogonal to this PR.
- **Multi-region replication** — currently 1 hub. If we ever run >1 hub
  (e.g. geo-redundant `npm.example.com`), the per-stack uplink config needs
  primary+fallback URLs. The template's `uplinks:` structure supports
  this natively — just add a second uplink entry.
- **Token rotation automation** — operator runs the rotation manually
  today. A scheduled CI workflow could automate it, but that's a
  separate story.
