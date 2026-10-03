#!/usr/bin/env bash
# =============================================================================
# data-migrate.sh — Full data migration: Supabase PG → PG17
# =============================================================================
# Migrates all application data from old Supabase PostgreSQL to new PG17.
#
# What this script does:
#   1. Creates auth.users table in PG17 (FK compatibility — 155 tables depend on it)
#   2. Exports auth.users + auth.identities data from old DB
#   3. Exports all public schema table data (299 tables)
#   4. Disables FK constraints + triggers in target
#   5. Imports data in bulk
#   6. Re-encrypts vault.secrets (pgsodium → pgcrypto)
#   7. Resets all sequences
#   8. Re-enables constraints + triggers
#   9. Validates row counts
#
# Prerequisites:
#   - PG17 schema already applied (tables, functions, policies)
#     via: 000_init_roles_schemas.sql (incl. vault) → baseline/migrations
#   - vault-seed.sh already ran (vault encryption key configured)
#
# Usage:
#   ./scripts/data-migrate.sh
#   ./scripts/data-migrate.sh --dry-run       # Show plan, don't execute
#   ./scripts/data-migrate.sh --skip-auth      # Skip auth.users migration
#   ./scripts/data-migrate.sh --tables-only    # Skip auth + vault, data only
#
# Required env vars:
#   PG_OLD_URL              — Old Supabase PG connection string
#   PG_V2_URL               — New PG17 connection string
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[data-migrate]${NC} $*"; }
warn() { echo -e "${YELLOW}[data-migrate]${NC} $*"; }
err()  { echo -e "${RED}[data-migrate]${NC} $*" >&2; }
info() { echo -e "${CYAN}[data-migrate]${NC} $*"; }
step() { echo -e "${BOLD}${GREEN}[data-migrate]${NC} ═══ $* ═══"; }

# ── Validate env ──
: "${PG_OLD_URL:?Missing PG_OLD_URL — old Supabase PG connection string}"
: "${PG_V2_URL:?Missing PG_V2_URL — new PG17 connection string}"

# Klíč trezoru si server čte sám ze souboru (/run/aisha-keys) — žádné PGOPTIONS.

# ── Parse args ──
DRY_RUN=false
SKIP_AUTH=false
TABLES_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=true ;;
    --skip-auth)    SKIP_AUTH=true ;;
    --tables-only)  TABLES_ONLY=true; SKIP_AUTH=true ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [--skip-auth] [--tables-only]"
      exit 0
      ;;
    *) err "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ── Temp directory for dump files ──
DUMP_DIR=$(mktemp -d)
trap 'rm -rf "$DUMP_DIR"' EXIT
log "Temp directory: ${DUMP_DIR}"

# ── Helper: run SQL on old DB ──
old_sql() { psql "$PG_OLD_URL" -t -A -v ON_ERROR_STOP=1 "$@"; }
# ── Helper: run SQL on new DB ──
new_sql() { psql "$PG_V2_URL" -t -A -v ON_ERROR_STOP=1 "$@"; }

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: Auth schema — create auth.users table in PG17
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$SKIP_AUTH" != "true" ]]; then
  step "STEP 1: Create auth.users table in PG17"

  # Check if auth.users already exists
  AUTH_EXISTS=$(new_sql -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users')")

  if [[ "$AUTH_EXISTS" == "t" ]]; then
    info "auth.users already exists — skipping CREATE"
  else
    log "Creating auth.users table (FK compatibility for 155+ tables)..."
    if [[ "$DRY_RUN" != "true" ]]; then
      new_sql <<'PSQL_EOF'
-- Minimal auth.users table for FK compatibility
-- GoTrue is replaced by Keycloak, but FK constraints remain.
-- keycloak_id column is the canonical user identity.
CREATE TABLE IF NOT EXISTS auth.users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id         uuid,
    aud                 text DEFAULT 'authenticated',
    role                text DEFAULT 'authenticated',
    email               text,
    encrypted_password  text DEFAULT '',
    email_confirmed_at  timestamptz,
    invited_at          timestamptz,
    confirmation_token  text DEFAULT '',
    confirmation_sent_at timestamptz,
    recovery_token      text DEFAULT '',
    recovery_sent_at    timestamptz,
    email_change_token_new text DEFAULT '',
    email_change        text DEFAULT '',
    email_change_sent_at timestamptz,
    last_sign_in_at     timestamptz,
    raw_app_meta_data   jsonb DEFAULT '{}',
    raw_user_meta_data  jsonb DEFAULT '{}',
    is_super_admin      boolean,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    phone               text,
    phone_confirmed_at  timestamptz,
    phone_change        text DEFAULT '',
    phone_change_token  text DEFAULT '',
    phone_change_sent_at timestamptz,
    email_change_token_current text DEFAULT '',
    email_change_confirm_status smallint DEFAULT 0,
    banned_until        timestamptz,
    reauthentication_token text DEFAULT '',
    reauthentication_sent_at timestamptz,
    is_sso_user         boolean DEFAULT false,
    deleted_at          timestamptz,
    is_anonymous        boolean DEFAULT false,
    keycloak_id         text
);

-- Indexes for FK lookups and auth queries
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_keycloak_id ON auth.users(keycloak_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_instance_id ON auth.users(instance_id);

-- Grant access to roles that reference auth.users
GRANT SELECT ON auth.users TO authenticated, service_role, anon;
GRANT INSERT, UPDATE ON auth.users TO service_role;
PSQL_EOF
      log "auth.users table created"
    else
      info "[DRY-RUN] Would create auth.users table"
    fi
  fi

  # Also create auth.identities if needed (some FK references)
  IDENT_EXISTS=$(new_sql -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities')")
  if [[ "$IDENT_EXISTS" != "t" ]]; then
    log "Creating auth.identities table..."
    if [[ "$DRY_RUN" != "true" ]]; then
      new_sql <<'PSQL_EOF'
CREATE TABLE IF NOT EXISTS auth.identities (
    provider_id   text NOT NULL,
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    identity_data jsonb NOT NULL DEFAULT '{}',
    provider      text NOT NULL,
    last_sign_in_at timestamptz,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    email         text GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

GRANT SELECT ON auth.identities TO authenticated, service_role;
PSQL_EOF
      log "auth.identities table created"
    fi
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: Export data from old database
# ══════════════════════════════════════════════════════════════════════════════
step "STEP 2: Export data from old database"

# Export auth.users
if [[ "$SKIP_AUTH" != "true" ]]; then
  log "Exporting auth.users..."
  pg_dump "$PG_OLD_URL" \
    --schema=auth \
    --table=auth.users \
    --table=auth.identities \
    --data-only \
    --no-owner \
    --no-acl \
    --column-inserts \
    --file="${DUMP_DIR}/auth_data.sql" 2>/dev/null || warn "auth export failed (GoTrue tables may not exist)"

  if [[ -f "${DUMP_DIR}/auth_data.sql" ]]; then
    AUTH_ROWS=$(grep -c "INSERT INTO" "${DUMP_DIR}/auth_data.sql" || echo "0")
    log "Exported ${AUTH_ROWS} auth rows"
  fi
fi

# Export all public schema data
log "Exporting public schema data (this may take a while)..."

if [[ "$DRY_RUN" == "true" ]]; then
  TABLE_COUNT=$(old_sql -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
  info "[DRY-RUN] Would export ${TABLE_COUNT} tables from public schema"
else
  pg_dump "$PG_OLD_URL" \
    --schema=public \
    --data-only \
    --no-owner \
    --no-acl \
    --disable-triggers \
    --file="${DUMP_DIR}/public_data.sql"

  PUBLIC_SIZE=$(du -h "${DUMP_DIR}/public_data.sql" | cut -f1)
  log "Exported public schema data: ${PUBLIC_SIZE}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: Prepare target — disable triggers and constraints
# ══════════════════════════════════════════════════════════════════════════════
step "STEP 3: Prepare target database"

if [[ "$DRY_RUN" != "true" ]]; then
  log "Disabling all triggers on public schema tables..."
  new_sql <<'PSQL_EOF'
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER ALL', r.tablename);
  END LOOP;

  -- Also disable auth triggers if they exist
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
    EXECUTE 'ALTER TABLE auth.users DISABLE TRIGGER ALL';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'identities') THEN
    EXECUTE 'ALTER TABLE auth.identities DISABLE TRIGGER ALL';
  END IF;
END;
$$;
PSQL_EOF
  log "Triggers disabled"

  log "Setting session_replication_role = replica (disables FK checks)..."
  # This will be set per-session during import
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: Import data
# ══════════════════════════════════════════════════════════════════════════════
step "STEP 4: Import data"

if [[ "$DRY_RUN" != "true" ]]; then
  # Import auth data first (FK target)
  if [[ "$SKIP_AUTH" != "true" && -f "${DUMP_DIR}/auth_data.sql" ]]; then
    log "Importing auth data..."
    psql "$PG_V2_URL" \
      -v ON_ERROR_STOP=0 \
      -c "SET session_replication_role = 'replica';" \
      -f "${DUMP_DIR}/auth_data.sql" \
      -c "SET session_replication_role = 'origin';" 2>&1 | tail -5
    log "Auth data imported"
  fi

  # Import public data
  log "Importing public schema data..."
  psql "$PG_V2_URL" \
    -v ON_ERROR_STOP=0 \
    -c "SET session_replication_role = 'replica';" \
    -f "${DUMP_DIR}/public_data.sql" \
    -c "SET session_replication_role = 'origin';" 2>&1 | tail -5
  log "Public schema data imported"
else
  info "[DRY-RUN] Would import auth + public data"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: Re-encrypt vault secrets (pgsodium → pgcrypto)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$TABLES_ONLY" != "true" ]]; then
  step "STEP 5: Re-encrypt vault.secrets"

  if [[ "$DRY_RUN" != "true" ]]; then
    VAULT_COUNT=$(new_sql -c "SELECT count(*) FROM vault.secrets" 2>/dev/null || echo "0")

    if [[ "$VAULT_COUNT" -gt 0 ]]; then
      log "Re-encrypting ${VAULT_COUNT} vault secrets with pgcrypto..."
      # The imported secrets have pgsodium-encrypted values.
      # We need to:
      #   1. Read decrypted values from OLD DB (with pgsodium)
      #   2. Re-encrypt in NEW DB (with pgcrypto)
      # This is handled by vault-seed.sh --import-admin-from=<old-url>
      # Here we just verify the state.
      warn "Vault secrets imported via pg_dump have INCOMPATIBLE encryption."
      warn "Run vault-seed.sh --import-admin-from=\$PG_OLD_URL to re-encrypt them."
      warn "System secrets should already be seeded by vault-seed.sh."

      # Delete the broken pgsodium-encrypted entries to prevent confusion
      new_sql <<'PSQL_EOF'
-- Mark stale vault entries: entries imported via pg_dump with pgsodium encryption
-- They cannot be decrypted by pgcrypto and will cause errors.
-- Delete them — they will be re-seeded by vault-seed.sh
DO $$
DECLARE
  v_count integer;
  v_key text;
BEGIN
  -- Try to decrypt each secret; if it fails, it's pgsodium-encrypted
  SELECT count(*) INTO v_count FROM vault.secrets;
  IF v_count > 0 THEN
    -- Klíč MIMO blok výjimky: chybějící klíč je porucha nástroje, ne důkaz
    -- pgsodium dat — jinak by ho WHEN OTHERS níž přečetl jako „truncate".
    v_key := public.aisha_vault_encryption_key();
    -- Safest: truncate and rely on vault-seed.sh to re-populate
    -- Only do this if vault-seed.sh hasn't already run (check for pgcrypto-encrypted entries)
    BEGIN
      PERFORM pgp_sym_decrypt(
        (SELECT secret::bytea FROM vault.secrets LIMIT 1),
        v_key
      );
      -- If this succeeds, secrets are already pgcrypto-encrypted (from vault-seed.sh)
      RAISE NOTICE 'Vault secrets already pgcrypto-encrypted — keeping %', v_count;
    EXCEPTION WHEN OTHERS THEN
      -- Decryption failed → pgsodium data → truncate
      TRUNCATE vault.secrets;
      RAISE NOTICE 'Truncated % pgsodium-encrypted secrets — re-seed with vault-seed.sh', v_count;
    END;
  END IF;
END;
$$;
PSQL_EOF
    else
      info "No vault secrets to re-encrypt"
    fi
  else
    info "[DRY-RUN] Would check/re-encrypt vault.secrets"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 6: Reset sequences
# ══════════════════════════════════════════════════════════════════════════════
step "STEP 6: Reset sequences"

if [[ "$DRY_RUN" != "true" ]]; then
  log "Resetting all sequences to match imported data..."
  new_sql <<'PSQL_EOF'
DO $$
DECLARE
  r RECORD;
  v_max bigint;
BEGIN
  FOR r IN
    SELECT
      s.relname AS seq_name,
      n.nspname AS schema_name,
      t.relname AS table_name,
      a.attname AS column_name
    FROM pg_class s
    JOIN pg_namespace sn ON s.relnamespace = sn.oid
    JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
    JOIN pg_class t ON d.refobjid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S'
      AND n.nspname IN ('public', 'auth')
  LOOP
    EXECUTE format(
      'SELECT COALESCE(max(%I), 0) FROM %I.%I',
      r.column_name, r.schema_name, r.table_name
    ) INTO v_max;

    IF v_max > 0 THEN
      EXECUTE format(
        'SELECT setval(%L, %s)',
        format('%I.%I', r.schema_name, r.seq_name),
        v_max
      );
    END IF;
  END LOOP;
END;
$$;
PSQL_EOF
  log "Sequences reset"
else
  info "[DRY-RUN] Would reset sequences"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7: Re-enable triggers and constraints
# ══════════════════════════════════════════════════════════════════════════════
step "STEP 7: Re-enable triggers"

if [[ "$DRY_RUN" != "true" ]]; then
  log "Re-enabling all triggers..."
  new_sql <<'PSQL_EOF'
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER ALL', r.tablename);
  END LOOP;

  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
    EXECUTE 'ALTER TABLE auth.users ENABLE TRIGGER ALL';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'identities') THEN
    EXECUTE 'ALTER TABLE auth.identities ENABLE TRIGGER ALL';
  END IF;
END;
$$;
PSQL_EOF
  log "Triggers re-enabled"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 8: Validate row counts
# ══════════════════════════════════════════════════════════════════════════════
step "STEP 8: Validate row counts"

ERRORS=0
TABLES_CHECKED=0

if [[ "$DRY_RUN" != "true" ]]; then
  log "Comparing row counts between source and target..."

  # Get table list from old DB
  TABLES=$(old_sql -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")

  while IFS= read -r table; do
    [[ -z "$table" ]] && continue

    OLD_COUNT=$(old_sql -c "SELECT count(*) FROM public.\"${table}\"" 2>/dev/null || echo "-1")
    NEW_COUNT=$(new_sql -c "SELECT count(*) FROM public.\"${table}\"" 2>/dev/null || echo "-1")

    if [[ "$OLD_COUNT" != "$NEW_COUNT" ]]; then
      err "MISMATCH: ${table} — old=${OLD_COUNT} new=${NEW_COUNT}"
      ((ERRORS++))
    fi
    ((TABLES_CHECKED++))
  done <<< "$TABLES"

  # Check auth.users
  if [[ "$SKIP_AUTH" != "true" ]]; then
    OLD_AUTH=$(old_sql -c "SELECT count(*) FROM auth.users" 2>/dev/null || echo "0")
    NEW_AUTH=$(new_sql -c "SELECT count(*) FROM auth.users" 2>/dev/null || echo "0")
    if [[ "$OLD_AUTH" != "$NEW_AUTH" ]]; then
      err "MISMATCH: auth.users — old=${OLD_AUTH} new=${NEW_AUTH}"
      ((ERRORS++))
    else
      log "auth.users: ${NEW_AUTH} rows ✓"
    fi
  fi

  log "Validated ${TABLES_CHECKED} tables"
else
  TABLE_COUNT=$(old_sql -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
  info "[DRY-RUN] Would validate ${TABLE_COUNT} table row counts"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
step "SUMMARY"
NEW_TABLE_COUNT=$(new_sql -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" 2>/dev/null || echo "?")
NEW_TOTAL_ROWS=$(new_sql -c "SELECT sum(n_live_tup) FROM pg_stat_user_tables WHERE schemaname = 'public'" 2>/dev/null || echo "?")

log "Tables in target: ${NEW_TABLE_COUNT}"
log "Total rows: ${NEW_TOTAL_ROWS}"

if [[ "$ERRORS" -gt 0 ]]; then
  err "VALIDATION ERRORS: ${ERRORS} table(s) with count mismatch!"
  err "Review mismatches above and re-run affected tables."
  exit 1
else
  log "All validations passed ✓"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  warn "(dry-run — no data was actually migrated)"
fi

log ""
log "Next steps:"
log "  1. Run vault-seed.sh --import-admin-from=\$PG_OLD_URL (if not already done)"
log "  2. Run storage-migrate.sh (MinIO bucket migration)"
log "  3. Run smoke-test.sh (verify full stack)"
