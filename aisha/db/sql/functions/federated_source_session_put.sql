-- ============================================================================
-- Source of truth: federated_source_session_put
-- Uloží relaci uživatele u zdroje (ADR-004, bod 1–4). JEN servisní role (broker).
--
-- `p_session_id` volí broker PŘEDEM, protože je součástí AAD šifrového textu.
-- Předchozí aktivní relace téhož (uživatel, zdroj) se ODVOLÁ s důvodem „nahrazena"
-- a zařadí do fronty odhlášení u zdroje — starý token u zdroje bez expirace jinak
-- platí navždy (revize rady B3). Její id se vrací, aby ji broker mohl odhlásit hned.
-- Účet zdroje (`provider_id`) živě patří nejvýš jednomu uživateli aishy: navázaný
-- u jiného uživatele = odmítnutí (převzetí se neřeší tiše).
-- Audit bez hodnot: jen id relace, zdroj a key_id.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_put(
  p_session_id uuid,
  p_user_id uuid,
  p_provider text,
  p_provider_id text,
  p_token_ct bytea,
  p_refresh_ct bytea,
  p_key_id text,
  p_expires_at timestamptz
)
RETURNS TABLE (source_session_id uuid, version integer, replaced_source_session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_old uuid;
BEGIN
  -- Stráž stojí na VOLAJÍCÍM (role z JWT / SET ROLE), ne na current_user: uvnitř
  -- SECURITY DEFINER je current_user vlastník funkce a prošel by vždy.
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL OR p_user_id IS NULL OR coalesce(btrim(p_provider), '') = ''
     OR coalesce(btrim(p_provider_id), '') = '' OR p_token_ct IS NULL OR length(p_token_ct) = 0
     OR coalesce(btrim(p_key_id), '') = '' THEN
    RAISE EXCEPTION 'FEDERATED_SESSION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'FEDERATED_SESSION_EXPIRES_IN_PAST' USING ERRCODE = '22023';
  END IF;

  -- Relace patří EXISTUJÍCÍMU uživateli aishy (vlastní chyba místo pádu na FK auditu).
  IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'FEDERATED_UNKNOWN_USER' USING ERRCODE = '22023';
  END IF;

  -- Souběžné connect téhož uživatele u téhož zdroje serializovat.
  PERFORM pg_advisory_xact_lock(hashtext('federated_source_sessions'), hashtext(p_user_id::text || '|' || p_provider));

  IF EXISTS (
    SELECT 1 FROM public.federated_source_sessions s
    WHERE s.provider = p_provider AND s.provider_id = p_provider_id
      AND s.user_id <> p_user_id AND s.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FEDERATED_PROVIDER_ID_TAKEN' USING ERRCODE = '23505';
  END IF;

  UPDATE public.federated_source_sessions s
     SET revoked_at = now(), revoke_reason = 'nahrazena', logout_next_at = now()
   WHERE s.user_id = p_user_id AND s.provider = p_provider AND s.revoked_at IS NULL
  RETURNING s.id INTO v_old;

  INSERT INTO public.federated_source_sessions
    (id, user_id, provider, provider_id, token_ct, refresh_ct, key_id, expires_at)
  VALUES
    (p_session_id, p_user_id, p_provider, p_provider_id, p_token_ct, p_refresh_ct, p_key_id, p_expires_at);

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
  VALUES (p_user_id, 'federace.relace_ulozena', 'federace.relace_ulozena', 'security', 'info',
          'federated_source_session', p_session_id::text,
          jsonb_build_object('provider', p_provider, 'key_id', p_key_id, 'nahrazena', v_old));

  RETURN QUERY SELECT p_session_id, 1, v_old;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_put(uuid, uuid, text, text, bytea, bytea, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_source_session_put(uuid, uuid, text, text, bytea, bytea, text, timestamptz) TO service_role;
