#!/usr/bin/env bash
# =============================================================================
# vault-seed.sh — Seed vault secrets for v2 PG17 architecture
# =============================================================================
# Seeds the 4 system secrets + optionally imports admin-managed secrets
# from old Supabase instance.
#
# System secrets (4):
#   - edge_functions_url     → Gateway internal URL (backward compat)
#   - service_role_key       → PostgREST service role JWT
#   - GITHUB_APP_ID          → GitHub App integration
#   - GITHUB_APP_PRIVATE_KEY → GitHub App PEM key
#
# Admin-managed secrets (10) — normally set via AllApiKeysManager UI:
#   openai_api_key, stripe_secret_key, stripe_publishable_key,
#   stripe_webhook_secret, packeta_api_key, packeta_api_password,
#   packeta_sender_id, homeassistant_base_url, homeassistant_access_token,
#   fio_bank_api_token
#
# Usage:
#   # Seed system secrets (reads from env):
#   ./scripts/vault-seed.sh
#
#   # Seed system + admin secrets from old Supabase vault:
#   ./scripts/vault-seed.sh --import-admin-from=postgresql://postgres:xxx@old-host:5432/postgres
#
# Required env vars:
#   PG_V2_URL                 — PG17 connection string
#   GATEWAY_URL               — e.g. http://gateway:3001
#   SERVICE_ROLE_KEY          — PostgREST service role JWT
#   GITHUB_APP_ID             — (optional, skipped if empty)
#   GITHUB_APP_PRIVATE_KEY    — (optional, skipped if empty)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[vault-seed]${NC} $*"; }
warn() { echo -e "${YELLOW}[vault-seed]${NC} $*"; }
err()  { echo -e "${RED}[vault-seed]${NC} $*" >&2; }

# ── Validate required env ──
: "${PG_V2_URL:?Missing PG_V2_URL — PG17 connection string}"
: "${GATEWAY_URL:?Missing GATEWAY_URL — e.g. http://gateway:3001}"
: "${SERVICE_ROLE_KEY:?Missing SERVICE_ROLE_KEY — PostgREST service role JWT}"

# Klíč trezoru si server čte sám ze souboru (/run/aisha-keys, entrypoint-wrapper.sh);
# posílat ho jako GUC (PGOPTIONS) by ho vystavilo celé relaci — viz heals 2026-09-25.

# ── Parse args ──
IMPORT_ADMIN_FROM=""
for arg in "$@"; do
  case "$arg" in
    --import-admin-from=*) IMPORT_ADMIN_FROM="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--import-admin-from=PG_URL]"
      echo ""
      echo "Seeds vault secrets in PG17. System secrets from env vars."
      echo "Optionally imports admin-managed secrets from old Supabase vault."
      exit 0
      ;;
    *) err "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ── Helper: upsert one secret (SQL-escaped, heredoc) ──
seed_secret() {
  local name="$1"
  local value="$2"
  local description="${3:-}"

  if [[ -z "$value" ]]; then
    warn "Skipping '$name' — empty value"
    return 0
  fi

  # Escape single quotes for SQL
  local esc_value="${value//\'/\'\'}"
  local esc_desc="${description//\'/\'\'}"

  psql "$PG_V2_URL" -t -A -v ON_ERROR_STOP=1 <<PSQL_EOF
DO \$\$
DECLARE
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM vault.secrets WHERE name = '${name}';

  IF v_existing IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing, '${esc_value}', '${name}', '${esc_desc}');
    RAISE NOTICE 'Updated secret: ${name}';
  ELSE
    PERFORM vault.create_secret('${esc_value}', '${name}', '${esc_desc}');
    RAISE NOTICE 'Created secret: ${name}';
  END IF;
END;
\$\$;
PSQL_EOF

  if [[ $? -eq 0 ]]; then
    log "✓ ${name}"
  else
    err "✗ ${name} — FAILED"
    return 1
  fi
}

# ── Verify vault schema exists ──
log "Verifying vault schema..."
VAULT_EXISTS=$(psql "$PG_V2_URL" -t -A -c "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'vault')")
if [[ "$VAULT_EXISTS" != "t" ]]; then
  err "vault schema not found in PG17. Run infra/postgres/000_init_roles_schemas.sql (substrate) first."
  exit 1
fi

log "Vault schema OK — seeding system secrets..."

# ── Seed 4 system secrets ──
seed_secret "edge_functions_url" \
  "${GATEWAY_URL}/internal" \
  "Gateway internal endpoint (backward compat for SQL functions)"

seed_secret "service_role_key" \
  "${SERVICE_ROLE_KEY}" \
  "PostgREST service role JWT"

if [[ -n "${GITHUB_APP_ID:-}" ]]; then
  seed_secret "GITHUB_APP_ID" \
    "${GITHUB_APP_ID}" \
    "GitHub App ID for evymo-aisha"
fi

if [[ -n "${GITHUB_APP_PRIVATE_KEY:-}" ]]; then
  seed_secret "GITHUB_APP_PRIVATE_KEY" \
    "${GITHUB_APP_PRIVATE_KEY}" \
    "GitHub App PEM private key"
fi

log "System secrets seeded."

# ── Import admin-managed secrets from old Supabase ──
if [[ -n "$IMPORT_ADMIN_FROM" ]]; then
  log "Importing admin-managed secrets from old Supabase vault..."

  # Old Supabase also uses vault.decrypted_secrets (pgsodium-based)
  # We need to set the OLD vault encryption key for the source DB
  ADMIN_KEYS=(
    "openai_api_key"
    "stripe_secret_key"
    "stripe_publishable_key"
    "stripe_webhook_secret"
    "packeta_api_key"
    "packeta_api_password"
    "packeta_sender_id"
    "homeassistant_base_url"
    "homeassistant_access_token"
    "fio_bank_api_token"
  )

  IMPORTED=0
  SKIPPED=0

  for key_name in "${ADMIN_KEYS[@]}"; do
    # Read from old Supabase (pgsodium-based vault.decrypted_secrets)
    OLD_VALUE=$(psql "$IMPORT_ADMIN_FROM" -t -A -c \
      "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${key_name}'" 2>/dev/null || true)

    OLD_DESC=$(psql "$IMPORT_ADMIN_FROM" -t -A -c \
      "SELECT description FROM vault.decrypted_secrets WHERE name = '${key_name}'" 2>/dev/null || true)

    if [[ -n "$OLD_VALUE" ]]; then
      seed_secret "$key_name" "$OLD_VALUE" "${OLD_DESC:-Imported from Supabase vault}"
      ((IMPORTED++))
    else
      warn "Secret '$key_name' not found in source vault"
      ((SKIPPED++))
    fi
  done

  log "Admin secrets imported: ${IMPORTED} imported, ${SKIPPED} skipped."
fi

# ── Summary ──
TOTAL=$(psql "$PG_V2_URL" -t -A -c "SELECT count(*) FROM vault.secrets")
log "Done. Total secrets in vault: ${TOTAL}"
