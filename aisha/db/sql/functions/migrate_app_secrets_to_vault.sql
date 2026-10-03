-- ============================================================================
-- Source of Truth: migrate_app_secrets_to_vault
-- Popis: IDEMPOTENTNÍ převod nešifrovaných řádků `app_secrets` do trezoru
--        (vault.secrets, šifrovaně). Volá ho heals při každém nasazení: klíč se
--        přenese JEN tam, kde ho trezor ještě nemá — hodnota, kterou mezitím
--        někdo nastavil v administraci (set_api_key_admin → trezor), se nepřepíše.
--
-- ⛔ PROČ (naměřeno 2026-09-28): set_api_key_admin psal vedle trezoru i
-- nešifrovanou kopii a get_app_secret/_batch četly právě ji. Po převodu čtou
-- všichni trezor a tabulka nemá grant pro nikoho (grants/app_secrets.sql).
--
-- Řádky v app_secrets NEMAŽE: smazání až po ověření sondou (návrh „jeden domov
-- pověření" §4) — smazat hodnotu dřív, než se ověří, že ji čtenář najde v
-- trezoru, by byla ztráta klíče. Vrací jen POČET převedených klíčů — žádné
-- hodnoty ani názvy (výstup heals jde do logu nasazení).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_app_secrets_to_vault()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT s.key, s.value
      FROM public.app_secrets s
     WHERE coalesce(s.value, '') <> ''
       AND NOT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = s.key)
     ORDER BY s.key
  LOOP
    PERFORM vault.create_secret(
      r.value,
      r.key,
      jsonb_build_object('migrated_from', 'app_secrets')::text
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_app_secrets_to_vault() FROM PUBLIC, anon, authenticated, service_role;
