-- ============================================================================
-- Source of truth: vault.create_secret
--
-- Zašifruje hodnotu klíčem trezoru a uloží ji do vault.secrets; vrátí id.
-- Dřív jen v infra/postgres/001_vault_pgcrypto.sql (initdb) s klíčem z GUC
-- a BEZ `REVOKE … FROM PUBLIC` — spustit ji tak mohl kdokoli s USAGE na
-- schématu vault (authenticated ho má). Domov je teď tady + heals.sql.
-- ============================================================================

-- ⛔ pgcrypto leží ve schématu `extensions` (000_init_roles_schemas.sql). Původní
-- initdb definice měla `search_path = vault, public` a pgp_sym_encrypt tak
-- nenašla — naměřeno 2026-09-25 (test:db:tajemstvi). Volá se proto s výslovným
-- schématem.
CREATE OR REPLACE FUNCTION vault.create_secret(
    new_secret text,
    new_name text DEFAULT NULL,
    new_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'  -- vše výslovně kvalifikované: vault.*, extensions.*, public.*
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO vault.secrets (name, secret, description)
    VALUES (
        new_name,
        extensions.pgp_sym_encrypt(new_secret, public.aisha_vault_encryption_key()),
        new_description
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vault.create_secret(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault.create_secret(text, text, text) TO service_role;
