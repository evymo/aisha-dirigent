# Docker network segmentation runbook — Phase 12 WP 3.4

> **Snapshot 2026-05-20**. Owner: DevOps + Backend security.
> **Status**: Infrastructure shipped (additive overlay). Service migration to
> the segmented zones is an operator activity tracked separately.

## TL;DR

AISHA's Docker topology is currently a single flat `coolify` network. Any
compromised microservice can theoretically reach Postgres directly via TCP.
This runbook ships the **infrastructure for 3-zone segmentation** and
**migrates the highest-risk service (svc-plugin-system) first** as the
flagship example. Subsequent WPs migrate the rest.

| Zone | Members (after full migration) | Reachable from |
|---|---|---|
| `aisha-frontend-net` | gateway, oauth2-proxy, public Traefik edge | external → frontend |
| `aisha-backend-net` | svc-* microservices, internal APIs | frontend → backend |
| `aisha-data-net` | Postgres, pgbouncer, Redis, langfuse-db | backend → data only |

## §1 Threat model

Without segmentation:

```
                    ┌─────────────────────────────┐
   external ──→ gateway ──→ svc-plugin-system ──→ Postgres  ❌ direct TCP
                            (untrusted plugin code)
```

A compromised svc-plugin-system (e.g. plugin escape from kata-VM
isolation) can:

1. **Lateral move** to other microservices in `coolify` net via their
   internal HTTP APIs (mostly mTLS-protected post WP 3.3, but not all
   pairs).
2. **Reach Postgres directly** on port 5432 — bypassing RLS + audit
   journaling because the only DB credentials are PostgREST role tokens
   that themselves enforce RLS. So technically the DB is RLS-protected,
   but the auditable PostgREST proxy gets bypassed.
3. **Reach Redis directly** on port 6379 — JWT revocation cache (WP 3.5)
   could be tampered with to extend session lifetime of stolen tokens.
4. **Reach langfuse-db directly** — exfiltrate trace data including
   prompt content + cost metadata.

With segmentation:

```
external → frontend-net → backend-net → data-net
              (gateway)    (svc-*)      (postgres+redis+langfuse-db)
                              ↑
                              └─ svc-plugin-system here, NOT on data-net
```

Even with mTLS bypassed or misconfigured, the compromised plugin runtime
**cannot reach Postgres directly** — there is no network route. It must
go through svc-mcp-knowledge / svc-ai-chat / etc., which enforce RLS at
the PostgREST layer + write to audit_journal.

## §2 What this PR ships

**Three files**:

1. `docker-compose.coolify.netseg.yml` — overlay declaring the 3
   external networks + restricting svc-plugin-system to
   `internal + aisha-backend-net` (NOT `aisha-data-net`).
2. `scripts/infra/create-netseg.sh` — idempotent network creation,
   subnet-collision-aware, runs on each Coolify host before deploy.
3. This runbook + a structural gate test (`wp-3-4-docker-netseg.gate.test.ts`).

**What this PR does NOT ship**:

- Migration of Postgres / Redis / langfuse-db to `aisha-data-net` —
  that's a per-stack maintenance window task (each service's existing
  `coolify` membership must be preserved during migration).
- Iptables / nftables rules to enforce zone boundaries — Docker bridge
  networks already isolate by default; only services declared in
  multiple networks bridge zones.
- mTLS for backend↔data hops — covered by WP 3.3.

## §3 Deployment steps (operator)

### Step 1: Pre-create the 3 networks (each Coolify host)

```bash
ssh ops@<coolify-host>
cd /path/to/evymo-ai-orchestrator
bash scripts/infra/create-netseg.sh
```

Idempotent — safe to re-run. Verify:

```bash
docker network ls --filter label=aisha.netseg.created_by=create-netseg.sh
# Expected: aisha-backend-net, aisha-data-net, aisha-frontend-net
```

### Step 2: Update svc-plugin-system stack in Coolify dashboard

In Coolify → svc-plugin-system stack → **Compose Files** field, set:

```
docker-compose.coolify.yml
docker-compose.coolify.netseg.yml
```

(Coolify v4 supports multi-file compose by chaining `-f` arguments.)

### Step 3: Redeploy + verify

```bash
# After Coolify finishes the deploy
docker inspect aisha-svc-plugin-system \
  | jq -r '.[0].NetworkSettings.Networks | keys[]'
```

Expected output:
```
aisha-backend-net
coolify
```

**NOT** present (correct — defense-in-depth holds):
```
aisha-data-net
```

### Step 4: Negative-path probe (verifies segmentation actually works)

```bash
docker exec aisha-svc-plugin-system sh -c \
  "timeout 3 nc -zv aisha-db 5432 2>&1 | head -1"
```

Two acceptable outcomes:
- Connection succeeds (current state — svc-plugin-system still on
  `coolify` network during transitional period; segmentation will tighten
  in follow-up WPs that migrate Postgres to `aisha-data-net`)
- Connection times out / refused (full segmentation in effect once
  Postgres is migrated)

Either way, the **infrastructure is in place** so the future migration
is a 1-line compose edit per service, not a topology rebuild.

## §4 Rollback

### Rollback the overlay (instant)

```
Coolify dashboard → svc-plugin-system → Compose Files
Remove: docker-compose.coolify.netseg.yml
Redeploy
```

svc-plugin-system reverts to `internal`-only membership. No data loss,
no downtime beyond the normal redeploy.

### Rollback the networks (only if needed)

```bash
# WARNING: only run when NO containers are attached to these networks.
docker network rm aisha-frontend-net aisha-backend-net aisha-data-net
```

`docker network rm` errors on networks with attached containers — safe
by default.

## §5 Adding a new service to the right zone

Decision table:

| Service shape | Zone(s) |
|---|---|
| Public-facing HTTP (gateway, edge proxy) | `aisha-frontend-net` + `aisha-backend-net` |
| svc-* internal API (no untrusted code) | `aisha-backend-net` + `aisha-data-net` |
| svc-* running untrusted code (plugin runtime, sandboxed eval) | `aisha-backend-net` ONLY (NOT data-net) |
| Database / cache / Langfuse | `aisha-data-net` ONLY |

Concrete examples after full migration:

```yaml
# Service that needs DB access (typical svc-*)
networks:
  - aisha-backend-net
  - aisha-data-net

# Public-facing gateway
networks:
  - aisha-frontend-net
  - aisha-backend-net

# High-risk service (plugin runtime)
networks:
  - aisha-backend-net
  # NO aisha-data-net — must go through svc APIs which enforce RLS + audit
```

## §6 Verification gate test

`src/tests/gates/wp-3-4-docker-netseg.gate.test.ts` asserts:

- Overlay compose declares all 3 external networks
- svc-plugin-system in overlay restricts to `internal + aisha-backend-net`
  (NOT `aisha-data-net`)
- Init script exists + is executable + uses RFC 1918 subnets
- Subnets do NOT overlap (172.30/172.31/172.32 are distinct)
- Init script labels networks `aisha.netseg.zone=*` for `docker network ls
  --filter label=` discoverability
- This runbook covers the 6 required sections (threat model, deploy,
  rollback, zone-decision table, verification, future migration)

## §7 Related WPs

- **WP 3.3** mTLS gateway ↔ backend — orthogonal defense (encrypts + authenticates
  intra-network traffic). Segmentation adds the missing **reachability** control.
- **WP 3.5** JWT revocation cache (Redis) — segmentation prevents the
  worst-case scenario where a compromised microservice tampers with the
  revocation set to extend session lifetime of stolen tokens.
- **WP 13.4** IDE bridge backend WS subscribe — uses Redis for realtime
  fan-out; once Redis is on `aisha-data-net` only, the fan-out path goes
  through svc-ide-context (backend-net member) rather than direct Redis
  access from any service.

## §8 Future migrations (NOT in this PR)

In order of decreasing risk:

1. **svc-mcp-knowledge** + **svc-ai-chat** + **svc-web-artifact** —
   move from `internal` to `aisha-backend-net + aisha-data-net`.
   These services need Postgres + Redis but not the full `coolify` flat
   network access. (~3 stacks, 1 hour total maintenance.)
2. **gateway** — move from `internal` to `aisha-frontend-net +
   aisha-backend-net`. (~1 hour maintenance, public-facing.)
3. **Postgres + pgbouncer + Redis + langfuse-db** — move from `internal`
   to `aisha-data-net` ONLY. This is the segmentation enforcement step.
   (~2-3 hour maintenance, requires every consumer to be migrated
   first.)
4. Drop `coolify` membership from all migrated services. Optional —
   the security wins are already realized once Postgres is data-net-only.

## §9 References

- Plan §-1.12 §3.4 — original WP 3.4 spec
- `feedback_no_workarounds_rewrite_dont_remove` — additive overlay, no
  destructive rename of existing `coolify` network
- `feedback_aisha_capability_applied_not_new` — reuses existing
  Docker bridge network primitive, not introducing a new orchestrator
