-- ============================================================================
-- Source of truth: vault.update_secret
--
-- Přepíše tajemství podle id (hodnotu zašifruje klíčem trezoru). Dřív jen
-- v infra/postgres/001_vault_pgcrypto.sql (initdb) s klíčem z GUC a BEZ
-- `REVOKE … FROM PUBLIC`. Domov je teď tady + heals.sql.
-- ============================================================================

-- ⛔ pgcrypto leží ve schématu `extensions` (000_init_roles_schemas.sql). Původní
-- initdb definice měla `search_path = vault, public` a pgp_sym_encrypt tak
-- nenašla — naměřeno 2026-09-25 (test:db:tajemstvi). Volá se proto s výslovným
-- schématem.
CREATE OR REPLACE FUNCTION vault.update_secret(
    secret_id uuid,
    new_secret text DEFAULT NULL,
    new_name text DEFAULT NULL,
    new_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'  -- vše výslovně kvalifikované: vault.*, extensions.*, public.*
AS $$
BEGIN
    UPDATE vault.secrets
    SET
        -- ⛔ NAMĚŘENO 2026-09-28 (Cleenack, UPGRADE #1080 nad PG17): `secret` je `text`
        -- (substrát 000_init), pgp_sym_encrypt vrací `bytea` → CASE bez přetypování
        -- padal „CASE types bytea and text cannot be matched" a KAŽDÁ změna tajemství
        -- selhala. `::text` = týž I/O tvar ('\x…'), jaký zapíše přiřazení v create_secret
        -- a jaký vault.decrypted_secrets čte zpět přes `::bytea`.
        secret      = CASE
                        WHEN new_secret IS NULL THEN secret
                        ELSE extensions.pgp_sym_encrypt(new_secret, public.aisha_vault_encryption_key())::text
                      END,
        name        = COALESCE(new_name, name),
        description = COALESCE(new_description, description),
        updated_at  = now()
    WHERE id = secret_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'vault secret with id % not found', secret_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION vault.update_secret(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault.update_secret(uuid, text, text, text) TO service_role;
