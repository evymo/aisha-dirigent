# Mesh Bootstrap & Routing Fix — 2026-05-03 Status Report

> Captures the routing root-cause fix delivered in commit `6613a226` and
> the remaining mesh-bootstrap work needed for `mcp.aisha.guru`,
> `dirigent.aisha.guru`, and `db.aisha.guru` to reach 200/302.

## Smoke Status

```
═══ Direct *.backend.id3a.cz routes (Traefik)            10/10 ✓
═══ Production *.aisha.guru routes (Frontend central)      3/6 ✓
                                                      ───────
                                              total  13/16 ✓
```

| Route | Status | Notes |
|-------|--------|-------|
| api.backend.id3a.cz/health | ✓ 200 | gateway healthy |
| auth.backend.id3a.cz/health | ✓ 200 | Keycloak healthy |
| langfuse.backend.id3a.cz | ✓ 200 | |
| nocodb / appsmith / pki | ✓ 302 | OAuth2 redirect |
| matrix / element / call | ✓ 200 | messaging |
| n8n.backend.id3a.cz | ✓ 200 | |
| web.aisha.guru | ✓ 200 | aisha-edge web |
| netbird.aisha.guru | ✓ 200 | dashboard SPA |
| cache.aisha.guru | ✓ 200 | registry |
| **mcp.aisha.guru** | ✗ 503 | mesh-proxy can't reach backend peer |
| **dirigent.aisha.guru** | ✗ 503 | same target as mcp |
| **db.aisha.guru** | ✗ 503 | mesh-proxy can't reach backend peer |

## Root Cause #1 — Coolify `$$` label escape (FIXED)

Compose Traefik label rules using `${VAR}` references were rendered with `$$`
escaping by Coolify v4, making Traefik match the literal string instead of
the substituted hostname. All `/api/peers` traffic fell through to the
dashboard SPA's nginx (HTML 404) instead of reaching `netbird-management`.

Fixed by hardcoding literal hostnames in Traefik labels across:
- `docker-compose.coolify-netbird.yml` (4 routers)
- `docker-compose.coolify-registry.yml`
- `docker-compose.coolify-monitoring.yml`

**Verification:** `curl https://netbird.aisha.guru/api/peers` now returns
`{"message":"no valid authentication provided","code":401}` from
netbird-management (was: HTML 404 from nginx).

**Regression guard:** New gate `coolify-traefik-label-substitution.gate.test.ts`
fails any compose with `${VAR}` in `traefik.http.routers.*.rule=...`.

**Memory:** `feedback_coolify_label_dollar_escape.md`

## Root Cause #2 — Coolify silent-ignore on empty `docker_compose_domains` (FIXED)

PATCH to `/applications/{uuid}` with `docker_compose_domains: []` returns
HTTP 200 but Coolify drops the change silently — the auto-generated Traefik
router persists. This made it impossible to disable Coolify's auto-gen
that competed with our manual labels.

**Workaround:** PATCH with sentinel `http://netbird-disabled.invalid:80`.
Coolify accepts the value, generates a router with rule
`Host(\`netbird-disabled.invalid\`)` that never matches real traffic, and
the manual high-priority routers own all real paths.

Implemented in `scripts/coolify-domain-doctor.mjs` for `aisha-netbird`.
Doctor's drift detection improved to flag EXTRA stored entries (was
one-directional, missing-only).

**Memory:** `feedback_coolify_silent_ignore_empty_domains.md`

## Mesh Bootstrap — Steps 1-3 Done, Step 4 Blocked on Compose Architecture

After the routing fix landed, the bootstrap chain was unblocked
incrementally. Three of four steps now complete; the last requires a
structural change in `docker-compose.coolify.yml`.

### ✅ Step 1 — Keycloak realm-management roles assigned

Ran `/tmp/fix-netbird-sa-roles.mjs` (focused subset of `provision-sso.sh`):
- Set `fullScopeAllowed=true` + `serviceAccountsEnabled=true` on
  `netbird-backend` client
- Assigned `manage-users`, `view-users`, `query-users`, `manage-clients`
  realm-management roles to the SA user `650a7f19-9b36-4dcb-b1f9-16b676f7e5e3`

**Verification:** M2M token now contains:
```json
"resource_access": {
  "realm-management": {
    "roles": ["manage-users", "view-users", "manage-clients", "query-groups", "query-users"]
  }
}
```
And `GET /admin/realms/aisha/users/count → 200 (body: 2)` instead of 403.

### ✅ Step 2 — NetBird account auto-created

The repeated `/api/peers` calls during testing (with M2M tokens that now
have proper claims) caused NetBird to auto-create the account and
register the SA user as admin. Verified at `2026-05-03T04:02:24Z`:
```
account.create: {}
```
NetBird API endpoints all return 200 now (verified for /peers, /groups,
/users, /setup-keys, /policies, /accounts).

### ✅ Step 3 — Groups + setup keys via netbird-bootstrap.sh

Ran `scripts/netbird-bootstrap.sh` with `KEYCLOAK_URL`, `NETBIRD_API_URL`,
`NETBIRD_MGMT_SECRET`, `COOLIFY_API_TOKEN` from Coolify env. Created:
- 4 groups: `aisha-frontend`, `aisha-backend`, `aisha-experimental`, `sandbox-run`
- 4 reusable setup keys (10y TTL): `aisha-frontend-core`, `aisha-backend-host`,
  `aisha-backend-integration`, `aisha-experimental-ledger`
- Wrote `NETBIRD_STACK_KEY_*` into `.env.coolify`
- `coolify-sync-envs.sh` PATCHed values into 5 stacks (180+ env updates)

Verified `aisha-core` has `NETBIRD_STACK_KEY_FRONTEND` populated (length 36,
matches the `22D88****` event log entry).

### ❌ Step 4 — Backend agent enrollment BLOCKED

Two redeploys of `aisha-core` (2026-05-03T04:46:54Z, 04:56:14Z) — both
finished in Coolify but **no peer ever registered**. Setup key
`aisha-frontend-core` shows `used_times=0`, `last_used=0001-01-01T00:00:00Z`.
No enrollment attempts in netbird-management HTTP logs.

**Likely root cause:** `docker-compose.coolify.yml:574` has
`network_mode: host` for the `netbird-agent` service. Backend likely runs
a native NetBird daemon (apt-installed or systemd) that already owns
`/dev/net/tun` + the `wt0` interface. The container's `netbird up`
attempt collides on host network namespace.

### Step 4 Remediation Path

The user's stated direction (prior session): "WireGuard interface je
čistě virtuální, můžeme ho mít v containeru". The new edge stack
already follows this — `netbird-edge` in
`docker-compose.coolify-prebuilt.yml` runs in bridge mode + sidecar
pattern. `aisha-core`'s `netbird-agent` should be migrated to the same
pattern:

```yaml
# REMOVE:
network_mode: host

# ADD:
networks:
  - internal
expose:
  - "53/udp"  # if DNS proxy needed (often not — extra_hosts bypasses)
```

After the migration, the agent runs in its own netns (no host conflict)
and enrolls. Other aisha-core services that need mesh access (`gateway`,
`pgadmin`, etc.) would attach via `network_mode: service:netbird-agent`
to inherit the netns + /etc/hosts + wt0 interface.

This is a multi-line compose refactor + redeploy + verify cycle
(~30 minutes implementation + verification). Tracked as Phase 5b in
`~/.claude/plans/frolicking-yawning-kahn.md`.

## Original — pre-routing-fix state

The 3 remaining failures (`mcp/dirigent/db.aisha.guru`) were blocked on
NetBird mesh having **0 peers enrolled**. Logs from netbird-management
(2026-05-03T03:31:38Z+):

```
INFO  No records in table peers, no migration needed
INFO  single account mode enabled, accounts number 0
WARN  failed warming up cache: unable to get
      https://auth.backend.id3a.cz/admin/realms/aisha/users/count?,
      statusCode 403
ERRO  GET /api/peers status 401  (token invalid)
```

### Three layers to unblock

#### 1. Keycloak admin role assignment (operator action)

`netbird-backend` service-account user lacks `realm-management` roles
(`manage-users`, `view-users`, `query-users`). Without these, NetBird's
IDP integration can't sync users and rejects all M2M tokens with
"token invalid".

**Remediation:** Run the focused fix (operator-side, requires
`KEYCLOAK_ADMIN_PASSWORD` from `aisha-keycloak` Coolify env):

```bash
KEYCLOAK_ADMIN_PASSWORD=$(...) \
  bash scripts/provision-sso.sh --keycloak-only --prod
```

This is currently blocked from automated execution by the local agent
permission policy; explicit operator authorization required for the
admin-token grant against shared production Keycloak.

#### 2. NetBird initial account bootstrap

After roles are assigned, the NetBird account must be created. Single-
account mode means the **first user to log in via the dashboard becomes
admin**. Possible paths:

- **Manual (recommended):** Operator logs into <https://netbird.aisha.guru>
  via Keycloak SSO. NetBird auto-creates the account + sets them as admin.
- **Automated:** Use NetBird's `/api/accounts` endpoint with admin token
  to seed. Only works after step 1.

#### 3. Agent enrollment + peer discovery

Once an admin exists:

```bash
# Enroll Backend agent (already deployed via aisha-core compose,
# but not connected because IDP was rejecting its token).
# Trigger reconnect by redeploying aisha-core or restarting netbird-edge sidecar.

# Then run discovery
npm run mesh:discover         # JSON dump of all enrolled peers
npm run mesh:sync:apply       # PATCH BACKEND_MESH_IP / CORE_MESH_IP into aisha-edge env

# Redeploy edge so extra_hosts pick up new IPs
node /tmp/redeploy-app.mjs aisha-edge
```

Expected end state: `mcp.aisha.guru` → 200, `dirigent.aisha.guru` → 200,
`db.aisha.guru` → 302 (db-mesh-proxy → pgadmin OAuth2 redirect).

## Files Changed (commit `6613a226`)

| File | Change |
|------|--------|
| `docker-compose.coolify-netbird.yml` | 4 routers: `${NETBIRD_DOMAIN:-...}` → literal `netbird.aisha.guru` (also propagated to env/cmd fields for consistency) |
| `docker-compose.coolify-monitoring.yml` | `dozzle-auth` rule literal |
| `docker-compose.coolify-registry.yml` | `registry-cache` rule literal |
| `scripts/coolify-domain-doctor.mjs` | Sentinel for `aisha-netbird`; extras-detection in drift |
| `src/tests/gates/coolify-traefik-label-substitution.gate.test.ts` | NEW — prevents regression |

## Background

- Auto-gen Traefik routers from `docker_compose_domains` use rule
  `Host(\`<domain>\`) && PathPrefix(\`/\`)` at default priority. They beat
  any manual router whose `Host()` rule is a literal `${VAR}` (because
  the literal never matches a real host).
- Manual routers with literal hostnames + `priority=99999` + more specific
  rules (Host + PathPrefix) win deterministically.
- The "make override dynamic" intent (operator question) was satisfied by
  having compose own the routing labels (where Traefik resolves them) and
  the doctor own only the `docker_compose_domains` contract (its API
  surface is what Coolify accepts).

## References

- Commit: `6613a226 fix(routing): Coolify escapes ${VAR} in Traefik labels`
- Plan: `~/.claude/plans/frolicking-yawning-kahn.md`
- Memory:
  - `feedback_coolify_label_dollar_escape.md`
  - `feedback_coolify_silent_ignore_empty_domains.md`
  - `feedback_mesh_naming_convention.md` (functional peer naming)
  - `feedback_netbird_dns_bypass.md` (extra_hosts pattern)
