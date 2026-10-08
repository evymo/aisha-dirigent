-- ============================================================================
-- Source of Truth: migrate_legacy_openai_key_to_credential
-- Popis: Jednorázový přesun klíče OpenAI z dosavadní administrace
--        (set_api_key_admin → vault.secrets jménem `openai_api_key`) do domova
--        pověření poskytovatelů (`credential:OPENAI_API_KEY`). Volá ho heals při
--        každém nasazení; idempotentní.
--
-- ⛔ PROČ (změřeno v kódu 2026-10-02): klíč `openai_api_key` nikdo nečetl —
-- svc-ai-chat volal edge_app_secrets s akcí 'get' a jménem 'OPENAI_API_KEY',
-- funkce zná jen 'get_many' → volání padalo a čtenář tiše bral env. Klíč
-- nastavený v administraci tak nikdy nedoletěl. Od teď ho čtečka pověření bere
-- JEN z nového domova.
--
-- Jak: PŘEJMENOVÁNÍ řádku trezoru — šifrotext zůstává týž, hodnota se nedešifruje
-- a neopustí DB. Když nový domov už pověření má (nastavila ho správa novou
-- cestou), starý řádek se NEMAŽE ani nepřepisuje: ohlásí se WARNING a o smazání
-- rozhodne člověk (čte se jen nový domov).
--
-- Souhra se starou cestou (ta se NEMĚNÍ): set_api_key_admin dál jméno
-- `openai_api_key` přijme a migrate_app_secrets_to_vault ho z nešifrované kopie
-- v app_secrets znovu vyrobí, pokud tam kopie zůstala. Obojí jen založí starý
-- řádek; nový domov to nepřepíše (tady 'oba_existuji' + WARNING), takže platí
-- hodnota z nového domova. Log nese jen jména.
--
-- Vrací stav (do logu nasazení, bez hodnot): 'nic' | 'presunuto' | 'oba_existuji'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_legacy_openai_key_to_credential()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stary uuid;
BEGIN
  SELECT s.id INTO v_stary FROM vault.secrets s WHERE s.name = 'openai_api_key' FOR UPDATE;
  IF v_stary IS NULL THEN
    RETURN 'nic';
  END IF;

  IF EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'credential:OPENAI_API_KEY') THEN
    RAISE WARNING 'vault: openai_api_key i credential:OPENAI_API_KEY existují — čte se jen credential:OPENAI_API_KEY; starý řádek po kontrole smažte';
    RETURN 'oba_existuji';
  END IF;

  UPDATE vault.secrets SET name = 'credential:OPENAI_API_KEY' WHERE id = v_stary;

  INSERT INTO public.audit_journal (user_id, action, area, severity, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    'PROVIDER_CREDENTIAL_RENAMED',
    'security',
    'warning',
    'provider_credential',
    'OPENAI_API_KEY',
    jsonb_build_object('env_var', 'OPENAI_API_KEY', 'from_vault_name', 'openai_api_key', 'storage', 'vault')
  );

  RETURN 'presunuto';
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_legacy_openai_key_to_credential() FROM PUBLIC, anon, authenticated, service_role;
