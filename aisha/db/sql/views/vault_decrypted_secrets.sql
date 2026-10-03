-- ============================================================================
-- Source of truth: vault.decrypted_secrets
--
-- Dešifrující pohled nad vault.secrets (náhrada Supabase Vault na pgcrypto).
-- Schéma a tabulku zakládá substrát infra/postgres/000_init_roles_schemas.sql;
-- pohled a funkce trezoru mají domov TADY, aby se změna dostala přes heals.sql
-- i na běžící databázi (initdb skript se na existujících datech nespustí).
--
-- ⛔ Klíč z aisha_vault_encryption_key() (soubor mimo DB), NE z GUC — dřív
-- current_setting('app.settings.vault_encryption_key'), čitelné každou rolí.
-- Funkce v pohledu běží s právy DOTAZUJÍCÍHO: pohled proto čte jen vlastník
-- klíče — SECURITY DEFINER spotřebitelé (edge_app_secrets,
-- get_api_keys_status_admin, get_github_app_secrets_from_vault,
-- handle_auth_send_email). Přímý SELECT pod jinou rolí skončí 42501 nahlas.
-- ============================================================================

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT
    s.id,
    s.name,
    extensions.pgp_sym_decrypt(
        s.secret::bytea,
        public.aisha_vault_encryption_key()
    ) AS decrypted_secret,
    s.description,
    s.created_at,
    s.updated_at
FROM vault.secrets s;

-- Dřívější SELECT pro service_role by bez klíče stejně skončil 42501;
-- odebrat, ať grant netvrdí přístup, který neexistuje.
REVOKE ALL ON vault.decrypted_secrets FROM PUBLIC, anon, authenticated, service_role;
