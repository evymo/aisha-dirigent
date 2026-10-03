# AISHA Stack Topology — Profile-driven service catalog

Single source of truth for **which services run, where, and at what URLs**. Replaces hardcoded `.backend.id3a.cz` literals with declarative resolution from a service catalog + deployment profile.

## Concepts

### Service Catalog (`config/services.json`)

Every service the platform knows about is declared once with:

| Field | Meaning |
|---|---|
| `id` | Stable abstract name (`keycloak`, `core`, `pki`, ...) used everywhere |
| `role` | What the service does (`auth`, `key-rotation`, `rag`, `workflow`, ...) |
| `tier` | `required` \| `important` \| `optional` \| `local-only` |
| `subdomain` | Short host-prefix in derived URLs (`auth`, `n8n`, ...) |
| `extra_subdomains` | Additional hostnames the service answers on (`pki-bridge`, `nocodb`, ...) |
| `public` | True if exposed via `*.aisha.guru` |
| `public_alias` | Override subdomain in public TLD (n8n→mcp on aisha.guru) |
| `compose` | Path to docker-compose-*.yml |
| `placement` | Default server (overridden per profile) |
| `depends_on` | Required upstream services |

### Profile (`config/profiles/*.json`)

A profile defines the **deployment shape**:

| Field | Meaning |
|---|---|
| `domain.public_tld` | Customer-facing TLD (`aisha.guru`) |
| `domain.internal_tld` | Per-server admin TLD (`id3a.cz`) |
| `domain.mesh_tld` | Mesh-internal TLD (`mesh.aisha.internal`) |
| `domain.internal_pattern` | Hostname template (`{subdomain}.{server}.{internal_tld}`) |
| `domain.public_pattern` | Public hostname template |
| `domain.mesh_pattern` | Mesh-overlay hostname template (used when `MESH_ENABLED=true`) |
| `servers` | List of physical hosts the profile uses |
| `service_overrides` | Per-service placement / tier promotion |
| `tier_filter` | Which tiers to include (default: `required`, `important`) |
| `exclude` / `include` | Explicit drops / opt-ins |
| `mesh_default` | Default `MESH_ENABLED` for this profile |

### Resolver (`scripts/lib/derive-domains.mjs`)

Deterministically computes the concrete URL for every service given:
- profile (from `AISHA_PROFILE` env, default `cloud-multi`)
- mesh state (from `MESH_ENABLED` env, default profile's `mesh_default`)

Output formats:
- `--json` — structured JSON for tooling / tests
- `--shell` — bash-sourceable env exports (cold-start consumes this)
- `--check` — sanity-check the topology, exit 1 on inconsistency

## The 3 supported profiles

### `cloud-multi` (production today)

Multi-server Coolify deployment:
- **Frontend** — public edge (Traefik, TLS) + NetBird mesh control + Docker registry + monitoring
- **Backend** — backend (DB, identity, PKI, n8n, Langfuse, NocoDB, Matrix, Ragnarok)
- **Experimental** — execution + ledger (Cosmos validator + Kata sandboxed runtime)

Mesh OFF: `auth.backend.id3a.cz` ← reach via Backend's public TLS
Mesh ON: `auth.mesh.aisha.internal` ← reach via NetBird WireGuard

### `cloud-single`

Single-server Coolify deployment (smaller footprint):
- All services on one host (`SINGLE_HOST_SERVER` env, default `backend`)
- Excludes `netbird` (no mesh), `ledger`, `exec` (Experimental-specific)
- Cross-stack reach via Docker network (no mesh dependency)

Mesh OFF: `auth.backend.id3a.cz` ← all services share one Coolify network on the host
Mesh ON: same as cloud-multi (mesh prefix uses internal mesh TLD)

### `local-dev` (developer machine)

Laptop / single Docker host:
- All services on `local`
- `*.local` domain (resolve via `/etc/hosts`, mDNS, or CoreDNS)
- Includes `vllm` opt-in for GPU developers
- Excludes infra-only stacks (`netbird`, `messaging`, `ledger`, `exec`, `registry`, `monitoring`)

**User's "abstract mode"** (mesh ON):
```
auth.local         → mesh.auth.local
n8n.local          → mesh.n8n.local
pki.local          → mesh.pki.local
api.local (public) → api.local           ← public stays public
```

Same same domain space, just disambiguated route through mesh-router.

## Tier semantics

| Tier | Inclusion default | When to use |
|---|---|---|
| `required` | Always present in cloud profiles | Auth (KC), data (core). Platform doesn't run without these. |
| `important` | Default-included in standard profiles | PKI (cert rotation), Ragnarok (RAG), n8n (workflows), Langfuse (LLM ops) |
| `optional` | Opt-in via `tier_filter` or `include[]` | Matrix chat, NocoDB/Appsmith admin UIs, Cosmos ledger, sandboxed exec |
| `local-only` | Never deployed to cloud | vLLM (GPU-bound), dev-only services |

## Operator runbook

```bash
# What does the current cloud-multi topology look like?
node scripts/lib/derive-domains.mjs --profile=cloud-multi

# Validate without printing
node scripts/lib/derive-domains.mjs --profile=cloud-multi --check

# Bash-sourceable env block (cold-start input)
node scripts/lib/derive-domains.mjs --profile=cloud-multi --shell > /tmp/topo.env
source /tmp/topo.env

# Compare mesh OFF vs mesh ON for the same profile
diff \
  <(node scripts/lib/derive-domains.mjs --profile=local-dev --mesh=off) \
  <(node scripts/lib/derive-domains.mjs --profile=local-dev --mesh=on)
```

## Adding a new service

1. Edit `config/services.json` — add entry with role, tier, subdomain, compose path
2. If it has multiple hostnames, list them in `extra_subdomains`
3. If different placement per profile, add to `service_overrides` in the profile JSON
4. Run `node scripts/lib/derive-domains.mjs --check` to validate
5. Gate test `topology-derivation.gate.test.ts` will catch any new structural issues

## Migration roadmap (status)

1. ✅ **Wave 1**: catalog + profiles + resolver + gate
2. ✅ **Wave 2**: cold-start.sh sources `--shell` output (opt-in via `AISHA_PROFILE`)
3. ✅ **Wave 3**: Compose env-block literals migrated to `${VAR:-default}` (Traefik labels excluded — see Wave 6)
4. ✅ **Wave 4**: Gate `no-hardcoded-domains-in-env.gate.test.ts` enforces no new hardcoded literals in env blocks/entrypoints
5. ✅ **Wave 5**: cold-start.sh defaults to `AISHA_PROFILE=cloud-multi` — resolver is the primary path
   - Escape hatch: `AISHA_PROFILE=legacy` bypasses resolver, sources `domains.env` directly

### Future waves (deferred — separate cleanup)

- **Wave 6**: **delete** the hostname-bearing Traefik labels — do NOT "migrate" them.
  This item previously read "migrate Traefik labels … would require Coolify $-escape
  investigation per-host", which framed the trap as an open design question. It is
  not: the investigation is done and the answer is that a Traefik label can carry
  **neither** form. `${VAR}` is escaped to `$$` by Coolify and never matches;
  a literal matches but bakes a deployment into the platform contract and activates
  an un-namespaced `priority=99999` router on a proxy shared with forks.
  Routing belongs in Coolify `docker_compose_domains` via the domain doctor — which
  is already how every host that serves today is routed. The 56 remaining labels are
  inert and are to be removed, along with their orphaned
  `traefik.http.services.*` groups. See [TRAEFIK_LABELS.md](./TRAEFIK_LABELS.md).
  Blocked on re-anchoring `caddy-template-upstreams.gate.test.ts`, which derives its
  work-list from those labels and would go vacuously green the moment they vanish.
- **Wave 7**: shrink baseline of `no-hardcoded-domains-in-env` gate (CSP frame-ancestors in langfuse, PKI cert SANs in pki entrypoint, mesh-router diagnostic ssl probes in prebuilt)

---

## Web artifact pipeline (svc-web-artifact)

Story-driven web design pipeline — operators upload, scrape, or
Aisha-redesign the canvas that lives in `web_pages.slug='index'`.

See [`docs/stack/web-artifact.md`](../stack/web-artifact.md) for the
operator how-to. This section documents the topology side:

- **Service:** `aisha-svc-web-artifact` (Fastify 5, port 3030 on `internal` network).
  Builds from `services/svc-web-artifact/`. Mounts `./domains:/app/domains:ro`
  so `seed-default` can read the community starter at boot.
- **Storage bucket:** `web-artifact-sources` (private, 50 MB cap,
  RLS: admin/staff INSERT, story-participant SELECT).
- **Tables:** `web_artifact_jobs` (new) + `web_pages.story_id` (added FK).
- **Gateway routes (functions.ts):**
  - `web-artifact-parse` → `http://svc-web-artifact:3030/parse`
  - `web-artifact-seed-default` → `http://svc-web-artifact:3030/seed-default`
  - `web-artifact-health` → `http://svc-web-artifact:3030/health`
- **n8n workflows:**
  - `WF_WEB_ARTIFACT_INGEST` — webhook `/web-artifact-ingest`, calls
    `start_web_artifact_ingest` RPC + `/functions/v1/web-artifact-parse`,
    audits via `log_integration_action` with tags
    `['stack','story','web_artifact','ingest']`.
  - `WF_OCCIPITUM_REDESIGN` — webhook `/web-artifact-redesign`, 3-pass
    LLM chain (Spark → Ember → Verify), enforces runtime block + i18n
    invariants. `AISHA_LLM_MOCK=1` bypasses real LLM for e2e determinism.
- **Audit tags:** every RPC writes `audit_journal.metadata.tags` containing
  `['stack','story','web_artifact', <transition>]`.
- **Bootstrap:** `svc-web-artifact` self-triggers `/seed-default` 3 s after
  app.listen() — idempotent (304 on repeat). Disable with
  `AISHA_SEED_ON_BOOT=0`.
- **Concurrency guard:** `apply_web_artifact_to_page` raises
  `stale_artifact_apply_another_version_landed` if `web_pages.updated_at`
  drifted between job creation and apply.

**Meta-principle:** this milestone is a thin wire-up of existing Aisha
capabilities (block registry, partner_stories, page builder, audit, LLM
gateway, microservice template). No new runtime blocks, no new
backend services beyond the parser. New blocks become Aisha-driven
dev stories — see `web_artifact_jobs.metadata.suggested_followup_story`.
