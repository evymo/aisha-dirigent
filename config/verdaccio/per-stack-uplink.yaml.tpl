# Verdaccio config template — per-stack operator instance
# =============================================================================
# Rendered by scripts/aisha-cold-start.sh (or scripts/render-per-stack-verdaccio-config.mjs)
# to /etc/verdaccio/config.yaml (or operator-defined path) on first deploy.
#
# This is the configuration for an OPERATOR's local Verdaccio that pulls
# @aisha/* packages from the hub registry ($AISHA_HUB_VERDACCIO_URL) without
# needing the hub's CI to fan-out publishes. Native Verdaccio uplink pattern.
#
# How services consume packages on a per-stack instance:
#   1. Service does `npm install @aisha/security`
#   2. Local Verdaccio doesn't have it yet
#   3. Local Verdaccio queries uplink `aisha-hub`
#   4. Hub responds with the latest @aisha/security tarball
#   5. Local Verdaccio caches the tarball + serves it to the service
#   6. Next install: served from cache (no hub round-trip needed)
#
# Substitution tokens (rendered by the cold-start step — NO hardcoded host):
#   {{AISHA_HUB_VERDACCIO_URL}}    → hub registry URL (AISHA_HUB_VERDACCIO_URL / VERDACCIO_URL)
#   {{AISHA_HUB_VERDACCIO_TOKEN}}  → operator's read-scope token for the hub
#   {{STORAGE_PATH}}               → path inside Verdaccio container (default /verdaccio/storage/data)
#   {{HTPASSWD_PATH}}              → path to local htpasswd (default /verdaccio/storage/htpasswd)
#   {{LISTEN_PORT}}                → Verdaccio HTTP port (default 4873)
# =============================================================================

storage: {{STORAGE_PATH}}

auth:
  htpasswd:
    file: {{HTPASSWD_PATH}}
    max_users: 10

uplinks:
  # Hub registry — pull-through proxy. Every @aisha/* request that local
  # Verdaccio doesn't have hits the hub and is cached afterwards.
  aisha-hub:
    url: {{AISHA_HUB_VERDACCIO_URL}}
    auth:
      type: bearer
      token: {{AISHA_HUB_VERDACCIO_TOKEN}}
    cache: true
    # Aggressive caching for @aisha/* — these change infrequently and a
    # cached version is always preferable to a hub round-trip during install.
    max_fails: 3
    fail_timeout: 5m
    timeout: 30s

  # Fallback to npmjs.org for community packages (typescript, vitest, etc.).
  # Public, no auth.
  npmjs:
    url: https://registry.npmjs.org/
    cache: true
    max_fails: 5
    fail_timeout: 5m
    timeout: 30s

packages:
  # AISHA-namespaced packages — always pulled from the hub. Local publish is
  # disabled to prevent operators from accidentally diverging from the hub.
  '@aisha/*':
    access: $authenticated
    publish: $admin   # $admin = nobody in the default htpasswd → effectively no local publish
    proxy: aisha-hub

  # Legacy n8n nodes (still namespace-free) — proxy hub.
  'n8n-nodes-aisha':
    access: $authenticated
    publish: $admin
    proxy: aisha-hub

  # Everything else falls back to npmjs.org.
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs

# Bind only to localhost inside the container — Coolify Traefik handles TLS.
listen:
  - 0.0.0.0:{{LISTEN_PORT}}

# Logging — JSON for ingestion by per-stack Loki/Sentry.
logs:
  - { type: stdout, format: pretty, level: http }

# Disable telemetry to upstream — operator stacks are air-gappable.
notify: []
experiments:
  token: true
