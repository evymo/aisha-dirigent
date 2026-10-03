-- ============================================================================
-- Source of truth: aisha_encrypt_column_audited
--
-- OWASP A02 — Cryptographic Failures. pgp_sym_encrypt helper that uses the
-- key from aisha_column_encryption_key(). Every encrypt is audited to
-- audit_journal as 'crypto.column_encrypt' — plaintext is NEVER stored, only
-- "who encrypted (something)" metadata. Matches the decrypt counterpart so
-- key use is symmetrically traceable.
--
-- Použití: JEN uvnitř SECURITY DEFINER funkce domova, která sama hlídá volajícího
-- (např. set_data_source_secrets), s kontextem pro audit:
--   public.aisha_encrypt_column_audited(v_hodnota,
--     jsonb_build_object('ucel', …, 'entita', …, 'entita_id', …, 'klic', …))
-- Role (anon/authenticated/service_role) EXECUTE nemají — přímé volání přes REST
-- by bylo obecné šifrovací/dešifrovací orákulum.
--
-- Requires the pgcrypto extension (installed via migrations).
-- ============================================================================

-- ⛔ ZPEVNĚNÍ (b) 2026-09-29: EXECUTE jen vlastník (volá ho set_data_source_secrets,
-- DEFINER); audit nese kontext (účel, klíč, zdroj, role z JWT) — symetricky s decrypt.
DROP FUNCTION IF EXISTS public.aisha_encrypt_column_audited(text);

CREATE OR REPLACE FUNCTION public.aisha_encrypt_column_audited(
  p_plaintext text,
  p_kontext   jsonb DEFAULT '{}'::jsonb
)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service boolean;
  v_ciphertext bytea;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_plaintext IS NULL THEN
    RETURN NULL;
  END IF;

  v_ciphertext := pgp_sym_encrypt(p_plaintext, public.aisha_column_encryption_key());

  -- Audit every encrypt — symmetric with decrypt. Plaintext NEVER lands here;
  -- this only records "who used the encryption key" so key-use is traceable.
  INSERT INTO public.audit_journal (user_id, user_role, action, action_type, area, severity, tags,
                                    entity_type, entity_id, details)
  VALUES (auth.uid(), public.get_jwt_role(), 'crypto.column_encrypt', 'crypto.column_encrypt',
          'security', 'info', ARRAY['crypto','encrypt'],
          nullif(p_kontext->>'entita', ''), nullif(p_kontext->>'entita_id', ''),
          coalesce(p_kontext, '{}'::jsonb) - 'hodnota');

  RETURN v_ciphertext;
END;
$$;
-- Jen vlastník (volá ho set_data_source_secrets, DEFINER). Žádný GRANT — brána to hlídá.
REVOKE ALL ON FUNCTION public.aisha_encrypt_column_audited(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
