#!/usr/bin/env bash
# =============================================================================
# init-new-tenant.sh — bootstrap a new tenant fork's overlay env + realm JSON
# =============================================================================
#
# Single command to generate everything a new tenant needs to deploy the AISHA
# stack against their own Keycloak realm, domain, and client IDs — no compose
# file edits required.
#
# Generates:
#   config/domains-<tenant>.env       — Coolify env overlay (15+ vars)
#   keycloak/<tenant>-realm.json      — Keycloak realm JSON (from template)
#   <tenant>/deploy/migrate-hook.sh   — Empty stub for tenant-specific seeds
#
# Usage:
#   bash scripts/init-new-tenant.sh \
#     --instance=foo \
#     --base-domain=foo.example.com \
#     --keycloak-domain=auth.foo.example.com \
#     [--keycloak-realm=foo-realm]   # default: <instance>-realm
#     [--app-prefix=foo]              # default: <instance>
#     [--client-prefix=foo-]          # default: <instance>-
#     [--dry-run]
#
# Exit codes:
#   0  success
#   1  missing required arg
#   2  output already exists (use --force to overwrite)
# =============================================================================

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
INSTANCE=""
BASE_DOMAIN=""
KEYCLOAK_DOMAIN=""
KEYCLOAK_REALM=""
APP_PREFIX=""
APP_PREFIX_EXPLICIT=false
CLIENT_PREFIX=""
COOLIFY_PROJECT_UUID=""
COOLIFY_ENVIRONMENT="production"
COOLIFY_SERVER_UUID=""
DRY_RUN=false
FORCE=false

# ── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --instance=*)        INSTANCE="${arg#*=}" ;;
    --base-domain=*)     BASE_DOMAIN="${arg#*=}" ;;
    --keycloak-domain=*) KEYCLOAK_DOMAIN="${arg#*=}" ;;
    --keycloak-realm=*)  KEYCLOAK_REALM="${arg#*=}" ;;
    --app-prefix=*)      APP_PREFIX="${arg#*=}"; APP_PREFIX_EXPLICIT=true ;;
    --client-prefix=*)   CLIENT_PREFIX="${arg#*=}" ;;
    --coolify-project-uuid=*) COOLIFY_PROJECT_UUID="${arg#*=}" ;;
    --coolify-environment=*)  COOLIFY_ENVIRONMENT="${arg#*=}" ;;
    --coolify-server-uuid=*)  COOLIFY_SERVER_UUID="${arg#*=}" ;;
    --dry-run)           DRY_RUN=true ;;
    --force)             FORCE=true ;;
    -h|--help)
      sed -n '2,33p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

# ── Validate ────────────────────────────────────────────────────────────────
if [[ -z "$INSTANCE" || -z "$BASE_DOMAIN" || -z "$KEYCLOAK_DOMAIN" ]]; then
  echo "ERROR: --instance, --base-domain, --keycloak-domain are required" >&2
  echo "Try: $0 --help" >&2
  exit 1
fi

# ── Derive defaults ─────────────────────────────────────────────────────────
KEYCLOAK_REALM="${KEYCLOAK_REALM:-${INSTANCE}-realm}"
APP_PREFIX="${APP_PREFIX:-${INSTANCE}}"
CLIENT_PREFIX="${CLIENT_PREFIX:-${INSTANCE}-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY_FILE="$ROOT/config/domains-${INSTANCE}.env"
REALM_FILE="$ROOT/keycloak/${INSTANCE}-realm.json"
HOOK_DIR="$ROOT/${INSTANCE}/deploy"
HOOK_FILE="$HOOK_DIR/migrate-hook.sh"
# config/tenant.env is the committed, SINGLE-VALUE selector that makes cold-start
# deterministic (AISHA_INSTANCE picks the overlay). It is per-CHECKOUT, not
# per-file — the model is one fork/checkout per instance. Writing it repoints
# THIS checkout at $INSTANCE.
TENANT_ENV_FILE="$ROOT/config/tenant.env"

# ── Pre-flight ──────────────────────────────────────────────────────────────
echo "━━━ new-tenant bootstrap ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  instance          $INSTANCE"
echo "  base domain       $BASE_DOMAIN"
echo "  keycloak domain   $KEYCLOAK_DOMAIN"
echo "  keycloak realm    $KEYCLOAK_REALM"
echo "  app prefix        $APP_PREFIX"
echo "  client prefix     $CLIENT_PREFIX"
echo "  dry-run           $DRY_RUN"
echo "  force overwrite   $FORCE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

for f in "$OVERLAY_FILE" "$REALM_FILE" "$HOOK_FILE" "$TENANT_ENV_FILE"; do
  if [[ -e "$f" && "$FORCE" != "true" ]]; then
    echo "ERROR: $f already exists. Pass --force to overwrite." >&2
    [[ "$f" == "$TENANT_ENV_FILE" ]] && echo "  NOTE: config/tenant.env exists — this checkout is already an instance. One fork per instance; use a fresh clone for $INSTANCE, or --force to repoint THIS checkout." >&2
    exit 2
  fi
done

# ── Generators ──────────────────────────────────────────────────────────────
gen_tenant_env() {
  cat <<EOF
# ============================================================================
# config/tenant.env — committed tenant-identity selector  (bash-sourced)
# ============================================================================
# Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ") by scripts/init-new-tenant.sh.
# Sourced FIRST by scripts/aisha-cold-start.sh so a fresh clone + --wipe
# deterministically selects this instance's overlay (config/domains-\${AISHA_INSTANCE}.env).
# ${VAR:-default} idiom → a pre-exported operator value still wins.
# ============================================================================

AISHA_INSTANCE="\${AISHA_INSTANCE:-$INSTANCE}"
EOF
}

gen_overlay() {
  cat <<EOF
# ============================================================================
# config/domains-${INSTANCE}.env — Coolify env overlay for $INSTANCE tenant
# ============================================================================
# Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ") by scripts/init-new-tenant.sh
#
# Source-of-truth for $INSTANCE deployment env. Loaded by
# scripts/aisha-cold-start.sh when AISHA_ENV=$INSTANCE, and by Coolify
# (paste into the per-app env tab) to override compose defaults that point
# to evymo upstream domains.
#
# See docs/TENANT_TEMPLATE.md for the full env-var contract.
# ============================================================================

# ── Identity ────────────────────────────────────────────────────────────────
INSTANCE_NAME=$INSTANCE
$(if $APP_PREFIX_EXPLICIT; then
    echo "# APP_NAME_PREFIX set (--app-prefix): apps named ${APP_PREFIX}-*, --wipe scoped to ^${APP_PREFIX}-."
    echo "APP_NAME_PREFIX=$APP_PREFIX"
  else
    echo "# APP_NAME_PREFIX left generic (aisha-*): the boundary gate forbids a tenant-named"
    echo "# manifest, so the generic aisha.manifest supplies the app LIST. cold-start passes"
    echo "# --story \"\${APP_NAME_PREFIX}\" so UNCOMMENTING this names apps ${INSTANCE}-* and scopes"
    echo "# --wipe to ^${INSTANCE}-. Optional (defense-in-depth) under the recommended"
    echo "# server+project-per-instance model where the Coolify project/server is the isolation."
    echo "# APP_NAME_PREFIX=$INSTANCE"
  fi)

# ── Coolify targeting (per-instance isolation — MUST differ per instance) ────
# CONTROL plane: own Coolify PROJECT (else two instances rebind + --wipe each
# other). DATA plane: own Coolify SERVER (own Docker daemon = own 'coolify'
# network + own aisha_* volume namespace; same-server co-location is NOT isolated
# without the data-plane-parameterization iteration). UUIDs are deployment
# secrets → set in .env-prod-backup / Coolify env (no-hardcoded-config gate).
# Sourced with set -a AFTER resolve_target_env, so they WIN. See docs/deploy/MULTI_INSTANCE.md.
$(if [ -n "$COOLIFY_PROJECT_UUID" ]; then echo "COOLIFY_PROJECT_UUID=$COOLIFY_PROJECT_UUID"; else echo "# COOLIFY_PROJECT_UUID=<this instance's own Coolify project uuid>"; fi)
COOLIFY_ENVIRONMENT=$COOLIFY_ENVIRONMENT
$(if [ -n "$COOLIFY_SERVER_UUID" ]; then echo "COOLIFY_SERVER_UUID_BACKEND=$COOLIFY_SERVER_UUID"; else echo "# COOLIFY_SERVER_UUID_BACKEND=<this instance's server uuid>"; fi)

# ── Three-zone domain contract (read by the variant-aware CI gates) ─────────
# Declares this fork's domain ZONES so the upstream CI gates
# (src/tests/gates/legacy-domains.gate.test.ts, domain-zoning, …) validate
# every domain reference against THESE. Declaring them is what lets a full
# tenant fork pass upstream CI unchanged — i.e. be a first-class launch variant
# instead of a CI failure.
#
#   PUBLIC   — client-facing routes (web/api/auth/…), edge Traefik + TLS.
#   INTERNAL — admin/ops, addressed per-server: <svc>.<server>.<INTERNAL_TLD>
#              where <server> ∈ coolify/servers.json keys (read dynamically).
#   MESH     — NetBird peer-to-peer DNS.
#
# A new single-server fork starts with PUBLIC == INTERNAL (one domain); split
# INTERNAL onto its own per-server TLD (<svc>.<server>.<INTERNAL_TLD>) once the
# cluster spans multiple servers — the reference deployment splits a client-facing
# TLD (PUBLIC) from a per-server ops TLD (INTERNAL) this way.
PUBLIC_TLD=$BASE_DOMAIN
INTERNAL_TLD=$BASE_DOMAIN
MESH_TLD=mesh.$BASE_DOMAIN

# ── Keycloak ────────────────────────────────────────────────────────────────
KEYCLOAK_DOMAIN=$KEYCLOAK_DOMAIN
KEYCLOAK_REALM=$KEYCLOAK_REALM
KC_REALM=$KEYCLOAK_REALM
VITE_KC_AUTHORITY=https://$KEYCLOAK_DOMAIN/realms/$KEYCLOAK_REALM
VITE_KC_CLIENT_ID=${CLIENT_PREFIX}app

# ── OIDC clients ────────────────────────────────────────────────────────────
OIDC_APP_CLIENT_ID=${CLIENT_PREFIX}app
OIDC_CLIENT_PREFIX=$CLIENT_PREFIX
# The gateway (services/gateway/src/auth/postgrest-jwt.ts) only accepts tokens
# whose azp/aud is in KC_ALLOWED_CLIENTS — default 'aisha-app,aisha-dirigent-device'.
# The tenant SPA client MUST be here or the gateway 403s every token at the
# PostgREST translation. The intranet oauth2-proxy client is included too so
# verifyKeycloakClaims accepts its tokens on the /intranet/* endpoints.
KC_ALLOWED_CLIENTS=${CLIENT_PREFIX}app,${CLIENT_PREFIX}appsmith-intranet-proxy
# S2: the DEDICATED narrow allow-list the gateway applies on /intranet/* only
# (config.kcIntranetAllowedClients) — just the intranet oauth2-proxy client, so
# an SPA/device token can never mint a user JWT through the intranet path.
KC_INTRANET_ALLOWED_CLIENTS=${CLIENT_PREFIX}appsmith-intranet-proxy

# ── Federation (svc-source-broker opt-in) ───────────────────────────────────
# The source-broker is a first-class OPTIONAL stack. A fork opts into source
# federation by deploying it; BROKER_DOMAIN is its public (traefik Host) domain,
# correct-by-construction from this fork's base domain. The operator-supplied
# SOURCE_* secrets (source app URL, read-replica, handshake mantras) stay BYO in
# the per-app env — never generated — and the broker compose fail-fasts on them.
BROKER_DOMAIN=broker.$BASE_DOMAIN
# SOURCE_API_URL=https://app.source.example      # (operator BYO) the federated source app
# SOURCE_PG_URL=postgresql://…?sslmode=require   # (operator BYO) source read-replica

# ── OAuth2 Proxy ────────────────────────────────────────────────────────────
OAUTH2_COOKIE_DOMAINS=.$BASE_DOMAIN
OAUTH2_WHITELIST_DOMAINS=.$BASE_DOMAIN

# ── Implementation seed/hook ────────────────────────────────────────────────
# The CANONICAL private-overlay applier (clones AISHA_INSTANCE_DATA_GIT_URL,
# applies NN_*.sql, exports operators.json). Do NOT point at a per-instance
# nested stub like $INSTANCE/deploy/migrate-hook.sh — from the fork root that
# resolves to a double-nested no-op that SILENTLY skips the whole overlay
# (observed footgun). Put implementation-specific SQL in the instance-data
# repo's NN_*.sql, not a hook stub.
AISHA_IMPLEMENTATION=$INSTANCE
AISHA_IMPLEMENTATION_HOOK=scripts/deploy/instance-data-hook.sh
AISHA_TENANT_HOOK=scripts/deploy/instance-data-hook.sh

# ── Gateway client allow-list ───────────────────────────────────────────────
# The aisha-gateway mints a PostgREST JWT only for tokens whose azp/aud is in
# this list. Must include the browser SPA client so app logins are accepted.
KC_ALLOWED_CLIENTS=${CLIENT_PREFIX}app

# ── Instance seed overlay (opt-in) ──────────────────────────────────────────
# A private instance-data repo (KB + web + content + operators) cloned into
# aisha/db/seed/instance/ at cold-start, plus a branded web template cloned into
# domains/templates/<domain>/. URLs are declared token-free on your git host
# (\${GIT_BASE_URL}; GIT_TOKEN is added for the clone — no hardcoded host).
# DEFAULT OFF — keep the platform's core seed until your repos
# exist, then uncomment AISHA_SEED_PROFILE=instance (+ REQUIRE to fail closed).
AISHA_SEED_DOMAIN=$INSTANCE
# AISHA_SEED_PROFILE=instance
# AISHA_SEED_REQUIRE_INSTANCE=1
# AISHA_INSTANCE_DATA_GIT_URL=\${GIT_BASE_URL}/<org>/${INSTANCE}-instance-data.git
# AISHA_WEB_DESIGN_GIT_URL=\${GIT_BASE_URL}/<org>/${INSTANCE}-web.git

# ── Federation broker (opt-in) ──────────────────────────────────────────────
# svc-source-broker federates an EXTERNAL source app's users into an aisha
# session (source OTP + mantra -> broker -> gateway /token-exchange -> role=
# authenticated). The broker uses the SHARED docker-compose.coolify-source-
# broker.yml; cold-start provisions its Coolify app ONLY when SOURCE_API_URL is
# set (coolify-story-init.sh gate). BROKER_DOMAIN is templated; the SOURCE_* +
# mantra are operator data — set them in the Coolify env, not committed here.
BROKER_DOMAIN=broker.$BASE_DOMAIN
# SOURCE_API_URL=https://api.<your-source>.example
# SOURCE_PG_URL=postgresql://<readonly>:<pw>@<replica>:5432/postgres?sslmode=require
# SOURCE_WEBHOOK_HMAC_SECRET=        # generate-secrets emits it; mirror on the source signer
# SOURCE_AUTH_HANDSHAKE_OUT=<source outbound mantra>
# SOURCE_AUTH_HANDSHAKE_IN=<source reply mantra>

# ── Per-service public domains (uncomment + customize as deployed) ─────────
# VITE_PUBLIC_DOMAIN=app.$BASE_DOMAIN
# N8N_DOMAIN=n8n.$BASE_DOMAIN
# STUDIO_DOMAIN=db.$BASE_DOMAIN
# GRAFANA_DOMAIN=grafana.$BASE_DOMAIN
EOF
}

gen_realm() {
  cat <<EOF
{
  "realm": "$KEYCLOAK_REALM",
  "displayName": "$INSTANCE",
  "displayNameHtml": "<b>$INSTANCE</b>",
  "enabled": true,
  "registrationAllowed": false,
  "resetPasswordAllowed": true,
  "rememberMe": true,
  "verifyEmail": true,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "sslRequired": "external",
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "clients": [
    {
      "clientId": "${CLIENT_PREFIX}app",
      "name": "$INSTANCE app (browser SPA)",
      "enabled": true,
      "publicClient": true,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": [
        "https://app.$BASE_DOMAIN/auth/callback",
        "https://app.$BASE_DOMAIN/auth/silent-renew",
        "${INSTANCE}://auth/callback"
      ],
      "webOrigins": ["+"],
      "attributes": {
        "pkce.code.challenge.method": "S256"
      },
      "defaultClientScopes": ["web-origins", "acr", "profile", "roles", "email"],
      "optionalClientScopes": ["address", "phone", "offline_access"]
    },
    {
      "clientId": "${CLIENT_PREFIX}nocodb-proxy",
      "name": "OAuth2 Proxy → NocoDB",
      "enabled": true,
      "publicClient": false,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["https://nocodb.$BASE_DOMAIN/oauth2/callback"]
    },
    {
      "clientId": "${CLIENT_PREFIX}appsmith-proxy",
      "name": "OAuth2 Proxy → Appsmith",
      "enabled": true,
      "publicClient": false,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["https://appsmith.$BASE_DOMAIN/oauth2/callback"]
    },
    {
      "clientId": "${CLIENT_PREFIX}studio-proxy",
      "name": "OAuth2 Proxy → pgAdmin Studio",
      "enabled": true,
      "publicClient": false,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["https://db.$BASE_DOMAIN/oauth2/callback"]
    },
    {
      "clientId": "${CLIENT_PREFIX}n8n-proxy",
      "name": "OAuth2 Proxy → n8n",
      "enabled": true,
      "publicClient": false,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["https://n8n.$BASE_DOMAIN/oauth2/callback"]
    }
  ],
  "roles": {
    "realm": [
      { "name": "admin",        "description": "Platform administrator" },
      { "name": "staff",        "description": "Platform staff" },
      { "name": "member",       "description": "End user" },
      { "name": "practitioner", "description": "Practitioner / clinician" },
      { "name": "studio_access", "description": "pgAdmin Studio access" },
      { "name": "n8n_access",   "description": "n8n workflow editor access" }
    ]
  },
  "clientScopes": [
    {
      "name": "roles",
      "protocol": "openid-connect",
      "attributes": { "include.in.token.scope": "true", "display.on.consent.screen": "false" },
      "protocolMappers": [
        {
          "name": "realm roles",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-realm-role-mapper",
          "config": {
            "claim.name": "roles",
            "jsonType.label": "String",
            "userinfo.token.claim": "true",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "multivalued": "true"
          }
        }
      ]
    }
  ]
}
EOF
}

gen_hook() {
  cat <<EOF
#!/bin/sh
# ============================================================================
# $INSTANCE/deploy/migrate-hook.sh — implementation post-migrate seed hook
# ============================================================================
# POSIX sh (runs inside node:22-alpine migrate container — only BusyBox sh
# + psql available).
#
# Fires after every \`npm run db:migrate\` + \`db:seed\` successfully completes.
# Wire into the platform by setting
# AISHA_IMPLEMENTATION_HOOK=$INSTANCE/deploy/migrate-hook.sh in your Coolify env
# (already set in config/domains-$INSTANCE.env). AISHA_TENANT_HOOK remains as a
# legacy alias for older deployments.
#
# Common content (see <tenant>/deploy/migrate-hook.sh for full reference):
#   - Foundation seeds: project_preset, branding_profiles, expert_rules, …
#   - Content seeds:    products, studies, questionnaires, …
#   - i18n upserts:     dynamic_translations rows
# ============================================================================
set -eu

# Fallback to platform-standard env names if tenant-specific ones unset
POSTGREST_URL="\${POSTGREST_URL:-\${SERVICE_URL_GATEWAY:-}}"
POSTGREST_SERVICE_TOKEN="\${POSTGREST_SERVICE_TOKEN:-\${SERVICE_ROLE_KEY:-}}"
export POSTGREST_URL POSTGREST_SERVICE_TOKEN

if [ -z "\${AISHA_DB_URL:-}" ]; then
  echo "[$INSTANCE/migrate-hook] ✗ AISHA_DB_URL not set — bailing" >&2
  exit 64
fi

echo "════════════════════════════════════════════════════════════════════"
echo " $INSTANCE/migrate-hook: applying tenant data layer"
echo "════════════════════════════════════════════════════════════════════"

# TODO: implement tenant-specific seeds. Reference impl:
#   <tenant>/deploy/migrate-hook.sh
#
# Pattern:
#   for seed in branding_profiles.sql expert_rules.sql; do
#     psql "\$AISHA_DB_URL" -v ON_ERROR_STOP=1 -f "aisha/db/seeds/$INSTANCE/\$seed"
#   done

echo " ✓ $INSTANCE/migrate-hook: no-op stub (edit me to add real seeds)"
EOF
}

# ── Emit ───────────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  echo "── [dry-run] would write $OVERLAY_FILE ──"
  gen_overlay
  echo
  echo "── [dry-run] would write $REALM_FILE ──"
  gen_realm | head -40
  echo "... (truncated)"
  echo
  echo "── [dry-run] would write $HOOK_FILE ──"
  gen_hook | head -20
  echo "... (truncated)"
  echo
  echo "── [dry-run] would write $TENANT_ENV_FILE ──"
  gen_tenant_env
  exit 0
fi

mkdir -p "$(dirname "$OVERLAY_FILE")" "$(dirname "$REALM_FILE")" "$HOOK_DIR"
gen_overlay     > "$OVERLAY_FILE"
gen_realm       > "$REALM_FILE"
gen_hook        > "$HOOK_FILE"
gen_tenant_env  > "$TENANT_ENV_FILE"
chmod +x "$HOOK_FILE"

echo "✓ Wrote $OVERLAY_FILE"
echo "✓ Wrote $REALM_FILE"
echo "✓ Wrote $HOOK_FILE (executable)"
echo "✓ Wrote $TENANT_ENV_FILE (AISHA_INSTANCE=$INSTANCE — this checkout is now the $INSTANCE instance)"
echo
echo "Next steps:"
echo "  1. Mount $REALM_FILE inside the Keycloak container at:"
echo "       /opt/keycloak/data/import/${INSTANCE}-realm.json"
echo "     and restart Keycloak so it imports the realm. (Or POST to the"
echo "     Admin API: scripts/keycloak/import-realm.sh $REALM_FILE)"
echo
echo "  2. Add the env-vars in $OVERLAY_FILE to Coolify (acme-core +"
echo "     any per-tenant app), or set AISHA_ENV=$INSTANCE and run:"
echo "       bash scripts/aisha-cold-start.sh"
echo
echo "  3. Edit $HOOK_FILE to add your tenant-specific seeds, then commit."
echo
echo "  4. See docs/TENANT_TEMPLATE.md for the full env-var contract."
