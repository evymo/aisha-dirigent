-- =============================================================================
-- PostgreSQL Role & Schema Initialization
-- =============================================================================
-- Creates all roles and schemas needed for the AISHA platform.
--
-- DB owner / admin role:
--   aisha_admin   — superuser used for migrations, healthcheck, AISHA_DB_URL
--   aisha_replicator — streaming replication role
-- PostgREST roles (must NOT be renamed — hardcoded in JWT ecosystem):
--   authenticator, anon, authenticated, service_role
-- External service roles:
--   nocodb_app, langfuse_app, synapse_user, n8n_app, keycloak_app, netbird_app
-- =============================================================================

-- ── Helper: idempotent role creation ──
DO $$
BEGIN
    -- PostgREST role-switching gateway
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator LOGIN NOINHERIT;
    END IF;

    -- Anonymous (unauthenticated) API role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;

    -- Authenticated API role (after JWT verification)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;

    -- Elevated service role (bypasses RLS)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;

    -- NocoDB application role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nocodb_app') THEN
        CREATE ROLE nocodb_app LOGIN;
    END IF;

    -- Langfuse application role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'langfuse_app') THEN
        CREATE ROLE langfuse_app LOGIN;
    END IF;

    -- Matrix Synapse role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'synapse_user') THEN
        CREATE ROLE synapse_user LOGIN;
    END IF;

    -- n8n workflow engine role (MCP gateway)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n_app') THEN
        CREATE ROLE n8n_app LOGIN;
    END IF;

    -- Keycloak OIDC identity provider role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak_app') THEN
        CREATE ROLE keycloak_app LOGIN;
    END IF;

    -- NetBird control-plane role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'netbird_app') THEN
        CREATE ROLE netbird_app LOGIN;
    END IF;

    -- AISHA platform admin (superuser — migrations, healthcheck, AISHA_DB_URL)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aisha_admin') THEN
        CREATE ROLE aisha_admin LOGIN SUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS;
    END IF;

    -- AISHA streaming replication role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aisha_replicator') THEN
        CREATE ROLE aisha_replicator LOGIN REPLICATION;
    END IF;
END
$$;

-- ── Role memberships (PostgREST switches: authenticator → anon/authenticated/service_role) ──
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;

-- Service role inherits authenticated capabilities
GRANT authenticated TO service_role;

-- ── Schemas ──
CREATE SCHEMA IF NOT EXISTS aisha_auth;  -- aisha_auth.uid()/role()/jwt() + users/identities tables
CREATE SCHEMA IF NOT EXISTS auth;        -- backward-compat proxy schema (stubs → aisha_auth)
CREATE SCHEMA IF NOT EXISTS storage;     -- storage RLS references
CREATE SCHEMA IF NOT EXISTS extensions;  -- pg extensions home
CREATE SCHEMA IF NOT EXISTS langfuse;    -- Langfuse dedicated schema
CREATE SCHEMA IF NOT EXISTS keycloak;    -- Keycloak OIDC dedicated schema
CREATE SCHEMA IF NOT EXISTS n8n;         -- n8n workflow engine dedicated schema
CREATE SCHEMA IF NOT EXISTS netbird;     -- NetBird control plane dedicated schema
CREATE SCHEMA IF NOT EXISTS aisha_meta;  -- AISHA platform metadata (migration_log, etc.)

-- ── Schema grants ──
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA aisha_auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;  -- backward compat

-- NocoDB: public schema. Postgres 15+ revoked CREATE on public by default;
-- nocodb potřebuje CREATE pro xc_knex_migrations table na first start.
GRANT USAGE, CREATE ON SCHEMA public TO nocodb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nocodb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nocodb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nocodb_app;

-- Langfuse: dedicated schema
GRANT USAGE, CREATE ON SCHEMA langfuse TO langfuse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA langfuse TO langfuse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA langfuse GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO langfuse_app;

-- Keycloak: dedicated schema
GRANT CONNECT ON DATABASE postgres TO keycloak_app;
GRANT USAGE, CREATE ON SCHEMA keycloak TO keycloak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA keycloak TO keycloak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA keycloak GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keycloak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA keycloak GRANT USAGE, SELECT ON SEQUENCES TO keycloak_app;

-- n8n: dedicated schema (workflow engine)
GRANT CONNECT ON DATABASE postgres TO n8n_app;
GRANT CREATE ON DATABASE postgres TO n8n_app;
GRANT USAGE, CREATE ON SCHEMA n8n TO n8n_app;
ALTER SCHEMA n8n OWNER TO n8n_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA n8n TO n8n_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA n8n GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO n8n_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA n8n GRANT USAGE, SELECT ON SEQUENCES TO n8n_app;

-- NetBird: dedicated schema (control-plane state)
GRANT CONNECT ON DATABASE postgres TO netbird_app;
GRANT USAGE, CREATE ON SCHEMA netbird TO netbird_app;
ALTER SCHEMA netbird OWNER TO netbird_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA netbird TO netbird_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA netbird GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO netbird_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA netbird GRANT USAGE, SELECT ON SEQUENCES TO netbird_app;
GRANT netbird_app TO postgres;

-- ── Extensions ──
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector;          -- pgvector (own schema)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Make extensions available in search_path
ALTER DATABASE postgres SET search_path TO public, extensions;

-- ── aisha_meta: platform metadata schema ──
-- aisha_admin owns this schema; service_role can INSERT for migration log
GRANT USAGE ON SCHEMA aisha_meta TO service_role, authenticated;

CREATE TABLE IF NOT EXISTS aisha_meta.migration_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id       uuid NOT NULL DEFAULT gen_random_uuid(),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    status       text CHECK (status IN ('running', 'ok', 'error')),
    exit_code    int,
    applied_migrations text[],
    error_message text,
    env_info     jsonb
);

CREATE INDEX IF NOT EXISTS idx_migration_log_run_id ON aisha_meta.migration_log(run_id);
CREATE INDEX IF NOT EXISTS idx_migration_log_started_at ON aisha_meta.migration_log(started_at);

GRANT SELECT, INSERT, UPDATE ON aisha_meta.migration_log TO service_role;
GRANT USAGE ON SEQUENCE aisha_meta.migration_log_id_seq TO service_role;

-- ── aisha_auth: user registry tables ──
-- Lightweight user/identity registry. Users are managed in Keycloak;
-- this table is the DB-side anchor for FK constraints and admin queries.
-- Populated by: keycloak-role-sync, user_upsert triggers, or first-request hooks.

CREATE TABLE IF NOT EXISTS aisha_auth.users (
    id                  uuid         NOT NULL PRIMARY KEY,
    email               text,
    raw_user_meta_data  jsonb        DEFAULT '{}'::jsonb,
    created_at          timestamptz  DEFAULT now(),
    updated_at          timestamptz  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aisha_auth.identities (
    id              uuid    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid    NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
    provider        text    NOT NULL,
    provider_id     text    NOT NULL,
    email           text,
    identity_data   jsonb   DEFAULT '{}'::jsonb,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    last_sign_in_at timestamptz,
    UNIQUE (provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_aisha_auth_identities_user_id ON aisha_auth.identities(user_id);
CREATE INDEX IF NOT EXISTS idx_aisha_auth_identities_provider ON aisha_auth.identities(provider, provider_id);

GRANT USAGE ON SCHEMA aisha_auth TO anon, authenticated, service_role;
GRANT SELECT ON aisha_auth.users TO authenticated, service_role;
GRANT SELECT ON aisha_auth.identities TO authenticated, service_role;
GRANT INSERT, UPDATE ON aisha_auth.users TO service_role;
GRANT INSERT, UPDATE ON aisha_auth.identities TO service_role;

-- ── aisha_auth.uid() / aisha_auth.role() / aisha_auth.jwt() ──
-- Called by RLS policies. Extract claims from PostgREST JWT GUC.

CREATE OR REPLACE FUNCTION aisha_auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH claims AS (
        SELECT
            COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) AS payload,
            nullif(current_setting('request.jwt.claim.sub', true), '') AS claim_sub
    ),
    resolved AS (
        SELECT
            nullif(payload ->> 'sub', '') AS jwt_sub,
            nullif(payload ->> 'aisha_user_id', '') AS aisha_user_id,
            claim_sub
        FROM claims
    )
    SELECT COALESCE(
        CASE
            WHEN aisha_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN aisha_user_id::uuid
        END,
        (
            SELECT i.user_id
            FROM aisha_auth.identities i
            WHERE i.provider = 'keycloak'
              AND i.provider_id = jwt_sub
            LIMIT 1
        ),
        CASE
            WHEN jwt_sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN jwt_sub::uuid
        END,
        CASE
            WHEN claim_sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN claim_sub::uuid
        END
    )
    FROM resolved;
$$;

CREATE OR REPLACE FUNCTION aisha_auth.role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        nullif(current_setting('request.jwt.claim.role', true), ''),
        'anon'
    );
$$;

CREATE OR REPLACE FUNCTION aisha_auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
    );
$$;

GRANT EXECUTE ON FUNCTION aisha_auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION aisha_auth.role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION aisha_auth.jwt() TO anon, authenticated, service_role;

-- ── auth.* backward-compat proxy stubs ──
-- Redirect auth.uid/role/jwt → aisha_auth.* so that any runtime code or
-- third-party extensions that still call the old names continue to work.

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT aisha_auth.uid(); $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT aisha_auth.role(); $$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT aisha_auth.jwt(); $$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

-- auth.users backward-compat view (SELECT only — no FK targets via view)
CREATE OR REPLACE VIEW auth.users AS SELECT * FROM aisha_auth.users;
GRANT SELECT ON auth.users TO authenticated, service_role;

-- auth.identities backward-compat view for legacy role-sync SQL references.
CREATE OR REPLACE VIEW auth.identities AS SELECT * FROM aisha_auth.identities;
GRANT SELECT ON auth.identities TO authenticated, service_role;

-- ── Supabase Storage path helper compatibility ──
-- MinIO serves the files, but existing RLS policies use Supabase-compatible
-- storage.foldername(name) to scope object paths by the first path segment.
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE
    WHEN position('/' in name) = 0 THEN ARRAY[]::text[]
    ELSE string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
  END;
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT NULLIF(regexp_replace(name, '^.*/', ''), '');
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT NULLIF(regexp_replace(storage.filename(name), '^.*\.', ''), storage.filename(name));
$$;

GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.filename(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.extension(text) TO anon, authenticated, service_role;

-- ── Storage stub tables (MinIO-backed stack, no Supabase Storage service) ──
-- storage.buckets + storage.objects stubs are required so that:
--   1. baseline.sql can INSERT bucket registrations (soft metadata)
--   2. RLS policies on storage.objects can be compiled
-- Actual file storage is served by MinIO; these PG tables are metadata-only.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text        PRIMARY KEY,
  name               text        NOT NULL UNIQUE,
  owner              uuid,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  public             boolean     DEFAULT false,
  avif_autodetection boolean     DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id        text        REFERENCES storage.buckets(id),
  name             text,
  owner            uuid,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata         jsonb,
  path_tokens      text[]      GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version          text
);

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects  ENABLE ROW LEVEL SECURITY;

-- authenticated: jen práva, která hlídá RLS. TRUNCATE/REFERENCES/TRIGGER RLS
-- nepodléhají (TRUNCATE vyprázdní celou tabulku bez ohledu na politiky) — stejné
-- pravidlo jako u public (brána authenticated-grants-bez-ddl).
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects  TO authenticated;
GRANT ALL ON storage.buckets TO service_role;
GRANT ALL ON storage.objects  TO service_role;
GRANT SELECT ON storage.buckets TO anon;
GRANT SELECT ON storage.objects  TO anon;

-- ── Trezor (vault) — schéma a tabulka (idempotentní) ──
-- Domov: TADY v substrátu, jako ostatní schémata mimo public. Pohled a funkce
-- trezoru jsou v SoT (aisha/db/sql/views/vault_decrypted_secrets.sql,
-- functions/vault_{create,update}_secret.sql) a potřebují, aby schéma a tabulka
-- existovaly dřív než baseline. Dřív je zakládal jen 001_vault_pgcrypto.sql při
-- initdb — DB založená bez initdb (probe brány upgradu, CREATE DATABASE) je
-- neměla a baseline padal na „schema vault does not exist" (naměřeno 2026-09-26).
-- Klíč trezoru NENÍ GUC: aisha_vault_encryption_key() čte /run/aisha-keys.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text UNIQUE,
    secret      text NOT NULL,       -- výstup pgp_sym_encrypt
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_secrets_name ON vault.secrets(name);
ALTER TABLE vault.secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vault_secrets_service_role ON vault.secrets;
CREATE POLICY vault_secrets_service_role ON vault.secrets
    FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT USAGE ON SCHEMA vault TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vault.secrets TO service_role;

-- ── Additional databases (idempotent) ──
-- Synapse needs its own DB (run separately via psql if needed)
-- SELECT 'CREATE DATABASE synapse OWNER synapse_user ENCODING UTF8 LC_COLLATE C LC_CTYPE C TEMPLATE template0'
-- WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'synapse');
