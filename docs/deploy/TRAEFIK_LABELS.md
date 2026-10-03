# Traefik Labels — Convention & Constraints

How to declare HTTP routing in AISHA compose files. **Read before adding any new public-facing service.**

> **CORRECTED 2026-07-18.** This document previously told you to declare routing in
> Traefik labels with a literal hostname, and to avoid `docker_compose_domains`.
> Both instructions were wrong, and following either produces a route that never
> matches. The corrected model is below. See [the measurement](#the-measurement)
> for how this was established.

## The rule

**Never put a hostname in a Traefik label — not `${VAR}`, not a literal.
Public routing is declared only in Coolify `docker_compose_domains`.**

```yaml
# ❌ DEAD — Coolify escapes $ -> $$, Traefik looks for a host named "${KEYCLOAK_DOMAIN}"
- "traefik.http.routers.kc.rule=Host(`${KEYCLOAK_DOMAIN}`)"

# ❌ BANNED — matches, but bakes a deployment into the platform contract, and
#    activates an un-namespaced priority=99999 router on a Traefik shared with forks
- "traefik.http.routers.kc.rule=Host(`auth.backend.id3a.cz`)"

# ✅ CORRECT — no router label at all; register the host with the domain doctor
#    (scripts/coolify-domain-doctor.mjs). Coolify then generates, server-side:
#      traefik.http.routers.https-0-<uuid>-keycloak.rule=Host(`auth.backend.id3a.cz`)
```

Host-**less** matchers stay legal in labels — they carry no `$` and no deployment
identity, and Coolify's generator cannot express them (netbird's gRPC routers):

```yaml
- "traefik.http.routers.netbird-grpc.rule=PathPrefix(`/management.ManagementService`)"
- "traefik.http.services.netbird-management.loadbalancer.server.scheme=h2c"
```

## Why: the escape hits label VALUES only

Coolify rewrites `$` → `$$` when rendering a container's label **values**, and only
there. Docker then reads `$$` as an escaped literal `$`, so the variable never
expands and Traefik searches for a host literally named `${VAR}`. It matches
nothing, forever, with **no error and no log line**.

### The measurement

Every other YAML site is untouched by that rewrite. Counted across this repo
(2026-07-18):

| site | `${VAR}` uses | fate |
|---|---|---|
| `environment:` | 751 | expands — works |
| `command:` / `healthcheck:` | 181 | expands — works |
| `networks:` / `aliases:` | 4 | expands — works |
| **`labels:`** | **56** | **escaped — dead** |

**1036 uses, 980 work, 56 die — identical syntax.** That asymmetry is the trap: you
learn "we write `${VAR}`" from 980 working examples and apply it in a label.
**Trust the SITE, not the pattern.**

Proven with `docker compose config`:

```
jeden.dolar: Host(`auth.example.com`)   ← ${DOM} interpolated
dva.dolary:  Host(`$${DOM}`)            ← $${DOM} stayed literal
```

And on the live keycloak container, where the same variable takes both fates in the
same file: `KC_HOSTNAME=auth.<PUBLIC_TLD>` expanded under `environment:`, beside
`keycloak-https.rule=Host(`${KEYCLOAK_DOMAIN_PUBLIC}`)` unexpanded under `labels:`.

## Why not `docker_compose_domains` — reassessed

This document used to reject it as "silent-drop-prone": a PATCH returns HTTP 200 but
the value sometimes does not persist (`feedback_coolify_api_quirks`). That failure is
real but it is now handled, not avoided — `scripts/coolify-domain-doctor.mjs` verifies
the PATCH persisted (#750) and refuses to touch `fqdn` (#749, Coolify 422). Meanwhile
the label path was never a working alternative: **every public host that serves today
routes through `docker_compose_domains`**, and the labels claiming to route are inert.

Nor were they ever load-bearing anywhere else: no compose file in this repo defines a
Traefik container (`grep -rn 'image:.*traefik' docker-compose*.yml` → 0),
`docker-compose.local.yml` contains no `traefik` at all, and
`scripts/local-compose-gen.mjs` `filterLabels()` drops every
`traefik.http.routers.*` key when generating local composes.

## Diagnosing a dead label

A dead label produces no error — just no router. Traefik answers **404 with no
`server:` header**; a request that reaches a service answers with one (e.g.
`server: Caddy`). Compare against a nonsense subdomain: an identical 404 means your
host has no router at all. Traefik's API is not exposed, so read the rendered labels
directly:

```bash
docker inspect <container> --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}' | grep traefik
```

Enforced by `src/tests/gates/coolify-traefik-label-substitution.gate.test.ts` (label
FORM) and `traefik-host-coverage.gate.test.ts` (topology COVERAGE).

## The standard label set

Every routable service follows this template:

```yaml
labels:
  # Mark Coolify-managed (UI deduplication)
  - "coolify.managed=true"
  # Disambiguate Traefik's network when service is on multiple networks
  - "traefik.docker.network=coolify"
  # Enable Traefik routing for this container
  - "traefik.enable=true"

  # Service backend — port + scheme. Use ONE service block per container.
  - "traefik.http.services.<svc-id>-svc.loadbalancer.server.port=<container-port>"

  # HTTPS router — primary entrypoint
  - "traefik.http.routers.<svc-id>-https.rule=Host(`<literal-hostname>`)"
  - "traefik.http.routers.<svc-id>-https.entrypoints=https"
  - "traefik.http.routers.<svc-id>-https.tls=true"
  - "traefik.http.routers.<svc-id>-https.tls.certresolver=letsencrypt"
  - "traefik.http.routers.<svc-id>-https.service=<svc-id>-svc"
  - "traefik.http.routers.<svc-id>-https.priority=99999"

  # HTTP→HTTPS redirect router
  - "traefik.http.routers.<svc-id>-http.rule=Host(`<literal-hostname>`)"
  - "traefik.http.routers.<svc-id>-http.entrypoints=http"
  - "traefik.http.routers.<svc-id>-http.middlewares=redirect-to-https"
  - "traefik.http.routers.<svc-id>-http.priority=99999"
```

### Why `priority=99999`

Coolify v4 auto-generates Traefik routers from `docker_compose_domains` entries. If the auto-generated router and your manual one both match the same Host, the higher-priority wins. `99999` ensures your explicit declaration is the active one regardless of what Coolify auto-generates.

### Why `tls.certresolver=letsencrypt`

This is a **lookup hint**, not an acquisition trigger. Without it, `tls=true` alone leaves Traefik without a cert reference → the router doesn't register → 404. Coolify pre-stores the wildcard `*.aisha.guru` cert under the `letsencrypt` resolver name; this label tells Traefik to look there.

## Source of truth chain

```
config/services.json                    config/profiles/cloud-multi.json
       │                                          │
       │   id: keycloak                           │   placement: { keycloak: backend }
       │   subdomain: auth                        │   internal_pattern: {sub}.{server}.{tld}
       │                                          │
       └─────────────┬────────────────────────────┘
                     ▼
       scripts/lib/derive-domains.mjs
                     │
                     ▼
       AUTH_DOMAIN=auth.backend.id3a.cz   ← env var (used in env blocks)
       KEYCLOAK_DOMAIN=auth.backend.id3a.cz
                     │
       ┌─────────────┴────────────────────┐
       │                                   │
       ▼                                   ▼
ENV BLOCKS:                          TRAEFIK LABELS:
  KC_HOSTNAME: ${KEYCLOAK_DOMAIN}      Host(`auth.backend.id3a.cz`)  ← LITERAL
  Substituted at deploy time          Hardcoded — must match the
                                       resolver output
```

The subdomain part of the literal hostname **MUST match `config/services.json`**. The gate test `traefik-host-coverage.gate.test.ts` enforces this — every `Host(` literal in compose must be a hostname the topology resolver emits for some profile.

## Adding a new public-facing service

1. **Catalog**: add entry in `config/services.json`:
   ```json
   "myservice": {
     "role": "...",
     "tier": "important",
     "subdomain": "mysvc",
     "public": true,
     "compose": "docker-compose.coolify-myservice.yml",
     "placement": "backend"
   }
   ```

2. **Verify resolver**: `node scripts/lib/derive-domains.mjs --check`. If you mis-typed something the gate catches it.

3. **Compose env block**: reference the env var (will be auto-emitted with the right value):
   ```yaml
   environment:
     MYSERVICE_DOMAIN: ${MYSERVICE_DOMAIN:-mysvc.backend.id3a.cz}
   ```

4. **Compose Traefik labels**: literal hostname matching the resolver:
   ```yaml
   labels:
     - "traefik.enable=true"
     - "traefik.docker.network=coolify"
     - "traefik.http.services.myservice-svc.loadbalancer.server.port=8080"
     - "traefik.http.routers.myservice-https.rule=Host(`mysvc.backend.id3a.cz`)"
     - "traefik.http.routers.myservice-https.entrypoints=https"
     - "traefik.http.routers.myservice-https.tls=true"
     - "traefik.http.routers.myservice-https.tls.certresolver=letsencrypt"
     - "traefik.http.routers.myservice-https.service=myservice-svc"
     - "traefik.http.routers.myservice-https.priority=99999"
     - "traefik.http.routers.myservice-http.rule=Host(`mysvc.backend.id3a.cz`)"
     - "traefik.http.routers.myservice-http.entrypoints=http"
     - "traefik.http.routers.myservice-http.middlewares=redirect-to-https"
     - "traefik.http.routers.myservice-http.priority=99999"
   ```

5. **Gate runs at commit-time**: if your hostname doesn't match the resolver output, the test fails before the change hits CI.

## Multi-host services (api alias on Frontend edge)

Some services live on Backend but have a public alias proxied via Frontend edge. Example: `api.backend.id3a.cz` (canonical, Backend) + `api.aisha.guru` (public alias, edge-proxy).

The catalog entry has `public: true` and the resolver emits both forms:
- `API_DOMAIN=api.backend.id3a.cz` (canonical, used by inter-service callers)
- `API_PUBLIC_DOMAIN=api.aisha.guru` (public alias)

In compose:
- Backend container (Backend, `core` stack) has Traefik labels for `api.backend.id3a.cz`
- Edge-proxy container (Frontend, `prebuilt` stack) has Traefik labels for `api.aisha.guru` and reverse-proxies to `${API_UPSTREAM}` (env-driven, not a label)

This is one of the few cases where `<api>.aisha.guru` and `<api>.backend.id3a.cz` both legitimately appear as Host literals — they're routes for the same logical service in two zones.

## Cookie / WHITELIST domains (OAuth2 Proxy)

OAuth2 Proxy has env vars for cookie scoping (NOT labels):

```yaml
environment:
  OAUTH2_PROXY_COOKIE_DOMAINS: ${OAUTH2_COOKIE_DOMAINS:-.backend.id3a.cz,.aisha.guru}
  OAUTH2_PROXY_WHITELIST_DOMAINS: ${OAUTH2_WHITELIST_DOMAINS:-.aisha.guru,.backend.id3a.cz}
```

These ARE substituted (env block, not label), and the resolver emits the right per-profile values. Per-server overrides exist as `OAUTH2_COOKIE_DOMAINS_FRONTEND` etc.

## Cross-references

- [STACK_TOPOLOGY.md](./STACK_TOPOLOGY.md) — service catalog + profile system
- Memory: `feedback_coolify_label_dollar_escape.md` — the original $-escape discovery
- Memory: `feedback_coolify_api_quirks.md` — why we avoid `docker_compose_domains` PATCH
- Memory: `feedback_coolify_silent_ignore_empty_domains.md` — Coolify v4 silent-drop on empty values
- Gates that touch this:
  - `traefik-host-coverage.gate.test.ts` — every Host label is a resolver-known hostname
  - `coolify-traefik-label-substitution.gate.test.ts` — no `${VAR}` in label values
  - `keycloak-routing-integral.gate.test.ts`, `langfuse-routing-integral.gate.test.ts`,
    `messaging-routing-integral.gate.test.ts`, `admin-routing-integral.gate.test.ts`,
    `pki-bridge-routing-integral.gate.test.ts` — per-stack routing assertions
