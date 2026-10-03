# Autonomous Cold-Start — Achieved State (2026-05-10)

**Status:** `bash scripts/aisha-cold-start.sh --wipe --skip-doctor` is the
single-command autonomous flow. End-state: **12/13 apps `running:healthy`**
on first run, 13/13 after one netbird redeploy (cert acquisition needs the
PKI stack live, which it is by the time netbird's pki-init runs but the
healthcheck timing is sensitive to first-boot cert rotation).

This doc replaces `AUTONOMOUS_LOOP_CEILING_2026-05-10.md` as the
definitive description of what the cold-start does, why each step
exists, and how to recover from common failure modes.

## TL;DR

```bash
bash scripts/aisha-cold-start.sh --wipe --skip-doctor
```

That single command:

1. Wipes all 13 Coolify aisha-* apps in parallel
2. Generates fresh secrets (preserving DB-locked ones across re-wipes)
3. Validates all 16 docker-compose.coolify-*.yml files
4. Creates Coolify apps idempotently (with retry on transient API failures)
5. Per-app env propagation + bootstrap-cred plumbing
6. Domain-doctor `--apply` recovery pass for any silent-dropped PATCH
7. Phase A → wave 1 (registry) → wave 2 (core+edge+pki) → wave 3 (KC)
8. Phase B inline (KC realm import + provision-sso + aisha-bootstrap user)
9. Phase C → wave 4 (DB + OIDC apps)
10. Phase D inline (NetBird groups + setup keys via aisha-bootstrap user)
11. Phase E → wave 5 (mesh re-enroll) → wave 6 (integration/ledger/exec)
    → wave 7 (messaging)
12. Post-deploy n8n workflow sync
13. Smoke-test routing + domain-doctor verification
14. Final summary with status + UUIDs

The total wall time on a clean cluster is about 25-30 minutes.

## Architectural invariants (do not break)

These are the constants every fix in this codebase must respect:

### 1. Routing source-of-truth = compose file Traefik labels (not API PATCH)

Coolify v4's `docker_compose_domains` PATCH endpoint silently drops some
writes under load (memory: `feedback_coolify_api_quirks.md`). Therefore:

- Public-facing services with `*.backend.id3a.cz` or `*.aisha.guru` hostnames
  declare routing in their compose file via explicit Traefik labels with
  literal hostnames (Coolify escapes `$` → `$$`, so `${VAR}` won't match).
- Pattern: `traefik.enable=true` + `traefik.http.services.<svc>-svc.loadbalancer.server.port=N` +
  `traefik.http.routers.<svc>-https.rule=Host('hostname.tld')` + TLS +
  `letsencrypt` cert resolver + HTTPS router with priority=99999 + HTTP→HTTPS
  redirect router using shared `redirect-to-https` middleware.
- Six stacks now use this pattern: KC, langfuse (observability),
  admin (nocodb + appsmith + intranet), messaging (synapse + element-web +
  element-call), n8n (orchestration). Each has a gate test enforcing the
  contract.

### 2. Bootstrap creds = generator pushes to Coolify env

When a script generates a credential, it MUST push that credential to
the consuming Coolify app's env via `/applications/{uuid}/envs/bulk`
PATCH. NOT rely on `coolify-deploy-init.sh`'s `set_coolify_env_if`,
which runs at step 4 BEFORE bootstrap scripts have populated the
`.env.coolify` source values.

Example: `aisha-bootstrap-user-init.sh`
- Step 6 pushes `AISHA_BOOTSTRAP_*` (ROPC creds for NetBird ownership)
  to `aisha-netbird` after Steps 2-4 generate them.
- Step 11 pushes `AISHA_PKI_BOOTSTRAP_*` (ROPC creds for cert issuance)
  to BOTH `aisha-netbird` and `aisha-pki` after Steps 7-10 generate them.

Both steps resolve UUIDs dynamically via `GET /applications` + jq filter
by `name=...`. No hardcoded UUIDs (those go stale on every `--wipe`).

### 3. KC admin operations = master `admin-cli` (not SA roles)

`OVERWRITE_EXISTING` realm import does NOT update existing
`service-account-X` user role assignments. Coupling cold-start
operations to a SA's role list creates a dependency that doesn't
survive realm re-imports.

`provision-sso.sh` and `aisha-bootstrap-user-init.sh` both authenticate
to KC admin API via master realm `admin-cli` password grant
(`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD`). Universal privileges,
no SA coupling.

### 4. Inline init = "the daemon's wrapper runs the bootstrap"

When a stack needs first-boot bootstrap that requires the daemon's own
socket (e.g. OpenXPKI: `oxi token add` requires `/run/openxpkid/openxpkid.sock`),
the bootstrap is inline in the daemon container's startup wrapper, not
a separate `restart: "no"` init container.

Why: Coolify v4's `docker compose up -d --wait` only surfaces container
lifecycle events in the deployment log, NOT child-container stdout.
Separate init containers exit before their logs can be retrieved.
Inlining the bootstrap into pki-server's wrapper means its stdout is
naturally part of pki-server's docker logs, which Coolify's app-logs
API exposes (when the app is running).

`pki-server`'s wrapper:
```sh
/usr/bin/openxpkictl start server --nd &
DAEMON_PID=$!
# wait for /run/openxpkid/openxpkid.sock
sh /etc/openxpki/local/scripts/pki-realm-bootstrap.sh
wait $DAEMON_PID
```

### 5. Idempotency contract — never re-key, never re-create

Every cold-start `--wipe` runs the bootstrap scripts again. They MUST
detect already-bootstrapped state and exit 0 without touching keys/data.

- `pki-realm-bootstrap.sh`: checks `openxpkiadm alias --realm X --token Y`
  for `not set` vs `alias :` markers
- `aisha-bootstrap-user-init.sh`: checks if KC user/client exists by
  name first, only creates if absent
- `netbird-bootstrap.sh`: setup keys validated against NetBird API
  before issuing new ones

Re-keying would invalidate every cert/token ever issued. Re-creating
KC users would orphan their permissions/roles. Idempotency is a
correctness invariant, not a perf optimization.

### 6. Tolerant orchestration — transient API errors must not abort

Coolify v4's API has stretches of slowness during cold-start
(probably DB churn from creating 13 apps). Defensive layer:
**every API call needs retry-with-backoff**, AND failures of cosmetic
operations (env metadata refresh, etc.) MUST be soft-fail (warn +
continue), not hard-fail (errexit + abort).

Implemented:
- `/applications` GET: 6× retry with 2,3,5,8,12s backoff + blind-create
  fallback (`coolify-story-init.sh`)
- `/applications/{uuid}/envs` GET: 3× retry with 5,10s backoff +
  soft-fail (env values already synced, only metadata refresh skipped)
  (`coolify-buildtime-envs.sh`)
- `docker_compose_domains` PATCH: 3× retry with verify-GET to detect
  silent drops + re-PATCH (`coolify-deploy-init.sh::set_coolify_domains`)
- App create: 3× retry with server-side existence recheck
  (`coolify-story-init.sh`)
- Wave summary: uses `resolvedClasses` map so post-grace classification
  matches the polling loop's accept criteria
  (`aisha-redeploy.mjs::waitForHealthyOrFailedDeploy`)

## Phase A→E flow (in `scripts/aisha-cold-start.sh` step 5)

Phase A — bring KC up (waves 1-3):
- wave 1: registry (Docker Hub pull-through cache)
- wave 2: core (PG17 + PostgREST + gateway), edge (web SPA), pki
- wave 3: keycloak (waits on aisha-db from core)

Phase B — KC bootstrap (no waves, runs cold-start.sh inline):
- KC smoke (auth.backend.id3a.cz/realms/aisha/.well-known/openid-configuration)
- `provision-sso.sh` — KC OIDC client secrets (langfuse, n8n, nocodb,
  appsmith, intranet-appsmith)
- `aisha-bootstrap-user-init.sh` — aisha-bootstrap + aisha-pki-bootstrap
  users + clients + ROPC creds + push to netbird/pki Coolify env

Phase C — wave 4 (DB+OIDC apps that need provisioned KC realm):
- netbird (cert flow needs PKI live), observability, orchestration, admin

Phase D — NetBird bootstrap (groups + setup keys):
- `netbird-bootstrap.sh` — uses aisha-bootstrap user ROPC to claim
  account ownership (so SA isn't account owner; IDP user-sync resolves
  the owner)

Phase E — final waves (5-7):
- wave 5: edge (re-enroll mesh agent against now-live management)
- wave 6: integration, ledger, exec (Experimental + Cosmos services)
- wave 7: messaging (Synapse — was KNOWN_BROKEN, now active)

## Hardcoded recovery — what to do if something fails

### "PKI bootstrap exit 1" or "pki-server unhealthy"
Most likely cause: `AISHA_PKI_BOOTSTRAP_*` not propagated yet.
Recovery:
```bash
SYNC_COOLIFY=1 bash scripts/aisha-bootstrap-user-init.sh
# → Step 11 pushes the creds to aisha-pki + aisha-netbird Coolify envs
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  "https://frontend.id3a.cz/api/v1/deploy?uuid=<aisha-pki-uuid>&force=true"
# wait ~3 min, verify pki-server is running:healthy
```

### "NetBird stuck restarting:unknown"
Most likely cause: cert acquisition failed (PKI bridge wasn't reachable
or PKI creds weren't in netbird's env).
Recovery: same `aisha-bootstrap-user-init.sh` Step 11 + redeploy
aisha-netbird.

### "auth.backend.id3a.cz returns 404"
The integral routing fix means this shouldn't happen unless
`docker-compose.coolify-keycloak.yml` was edited to drop the
explicit Traefik labels. Verify via:
```bash
grep "traefik.http.routers.keycloak-https" docker-compose.coolify-keycloak.yml
# should show 6 lines: rule, entryPoints, tls, certresolver, service, priority
```
If labels were removed, restore them and redeploy KC.

### "Coolify says Application is not running"
Coolify v4 limitation: the app-logs API returns this when ANY
container in the compose stack is unhealthy. Means you can't easily
read logs remotely. Either:
- Wait for the app to stabilize, then re-query
- Read deployment log via `GET /api/v1/deployments/{deployment_uuid}`
  (parses container lifecycle events but NOT child stdout)
- Use the inline-bootstrap pattern: surface child stdout via the main
  container's startup wrapper

## Gate tests — regression prevention

Each fix in this codebase comes with a gate test in `src/tests/gates/`
that runs in CI (`npm run test:gates`). The tests in this directory
that prevent regressions of cold-start fixes:

- `keycloak-realm-schema.gate.test.ts` — varchar(255) limits +
  service-account-netbird-backend role contract
- `coolify-env-contract.gate.test.ts` — buildtime envs reader retry +
  soft-fail
- `cold-start-doctor.gate.test.ts` — story-init retry + JSON parse
  guard + domain-doctor pre-deploy pass
- `keycloak-routing-integral.gate.test.ts` — KC declarative routing
- `langfuse-routing-integral.gate.test.ts` — Langfuse declarative
- `admin-routing-integral.gate.test.ts` — NocoDB + Appsmith declarative
- `messaging-routing-integral.gate.test.ts` — Synapse + Element +
  Element-Call declarative
- `pki-bootstrap-integral.gate.test.ts` — inline bootstrap pattern +
  oxi/openxpkiadm CLI + pki-keys volume
- `coolify-domain-format.gate.test.ts` — contract entries threshold
- `cold-start-hardening.gate.test.ts` — messaging history + PostgREST
  HMAC

Total: 1886 gate tests across 100 files (offline mode).

## What this proves about "musi to nabehnout od nuly"

`bash scripts/aisha-cold-start.sh --wipe --skip-doctor` is the single
command. From a clean Coolify state to 12/13 healthy on first pass,
13/13 after netbird picks up its cert. No host shell access required
(all the orchestration runs from the operator's workstation). No manual
`docker exec` debugging. The 31 commits this session each address one
specific orchestration bug, with a gate test ensuring the bug doesn't
return.
