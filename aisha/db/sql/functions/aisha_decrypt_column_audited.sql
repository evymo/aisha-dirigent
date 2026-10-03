-- ============================================================================
-- Source of truth: aisha_decrypt_column_audited
--
-- OWASP A02 — Cryptographic Failures. pgp_sym_decrypt helper that
-- (a) reads the active key via aisha_column_encryption_key()
-- (b) requires service_role or admin/staff role
-- (c) emits an audit_journal row for every successful decrypt — plaintext is
--     never logged, only "who saw what" metadata.
--
-- Encrypt side: see aisha_encrypt_column_audited.sql — emits a symmetric
-- 'crypto.column_encrypt' audit row so key use is traceable in both
-- directions, plaintext never logged.
--
-- ⛔ ZPEVNĚNÍ (b) 2026-09-29 — ŽÁDNÉ OBECNÉ DEŠIFROVACÍ ORÁKULUM:
--   · EXECUTE nemá žádná role kromě vlastníka. Dřív authenticated + service_role:
--     služba si šifrotext přečetla přes REST a dešifrovala přes RPC; admin/staff
--     dešifroval libovolný šifrotext, který získal. Změřeno 2026-09-29: jediný
--     volající v kódu je get_plugin_runtime_config (DEFINER, stráž „jen služba"),
--     na riq 0 dešifrování za celou historii — REVOKE nic nerozbije.
--   · Audit nese KONTEXT (p_kontext): účel, jméno klíče, plugin, zdroj, a roli
--     z JWT. Přes DEFINER je auth.uid() u služby NULL — bez kontextu audit nevěděl
--     ani kdo, ani co dešifroval. Hodnota ani délka se nezapisuje nikdy.
-- ============================================================================

DROP FUNCTION IF EXISTS public.aisha_decrypt_column_audited(bytea);

CREATE OR REPLACE FUNCTION public.aisha_decrypt_column_audited(
  p_ciphertext bytea,
  p_kontext    jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_plaintext text;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_ciphertext IS NULL THEN
    RETURN NULL;
  END IF;

  v_plaintext := pgp_sym_decrypt(p_ciphertext, public.aisha_column_encryption_key());

  -- Audit every decrypt — this is the data-access event. We DON'T log the
  -- plaintext, only the fact that decryption happened + by whom.
  INSERT INTO public.audit_journal (user_id, user_role, action, action_type, area, severity, tags,
                                    entity_type, entity_id, details)
  VALUES (auth.uid(), public.get_jwt_role(), 'crypto.column_decrypt', 'crypto.column_decrypt',
          'security', 'info', ARRAY['crypto','decrypt'],
          nullif(p_kontext->>'entita', ''), nullif(p_kontext->>'entita_id', ''),
          coalesce(p_kontext, '{}'::jsonb) - 'hodnota');

  RETURN v_plaintext;
END;
$$;
-- Jen vlastník (volají ho DEFINER funkce domova pověření). Žádný GRANT — brána to hlídá.
REVOKE ALL ON FUNCTION public.aisha_decrypt_column_audited(bytea, jsonb) FROM PUBLIC, anon, authenticated, service_role;
