-- ============================================================================
-- Source of truth: federated_source_session_rotate
-- Atomicky vymění šifrový text AKTIVNÍ relace (refresh u zdroje, rotace klíče
-- brokeru) — compare-and-swap na `version` (ADR-004, bod 6–7; revize V2, A14).
-- Nový access token a nový refresh se ukládají SPOLU. Neshoda verze nebo odvolaná
-- relace = FEDERATED_SESSION_STALE: souběžný refresh prohrál, broker si relaci
-- přečte znovu, NEodvolává ji. JEN servisní role.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_rotate(
  p_session_id uuid,
  p_expected_version integer,
  p_token_ct bytea,
  p_refresh_ct bytea,
  p_key_id text,
  p_expires_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_new integer;
  v_user uuid;
  v_provider text;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_token_ct IS NULL OR length(p_token_ct) = 0 OR coalesce(btrim(p_key_id), '') = ''
     OR p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'FEDERATED_SESSION_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE public.federated_source_sessions s
     SET token_ct = p_token_ct, refresh_ct = p_refresh_ct, key_id = p_key_id,
         expires_at = p_expires_at, version = s.version + 1, verified_at = now()
   WHERE s.id = p_session_id AND s.version = p_expected_version AND s.revoked_at IS NULL
  RETURNING s.version, s.user_id, s.provider INTO v_new, v_user, v_provider;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'FEDERATED_SESSION_STALE' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
  VALUES ((SELECT u.id FROM aisha_auth.users u WHERE u.id = v_user), 'federace.relace_obnovena', 'federace.relace_obnovena', 'security', 'info',
          'federated_source_session', p_session_id::text,
          jsonb_build_object('provider', v_provider, 'version', v_new, 'key_id', p_key_id, 'uzivatel', v_user));
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_rotate(uuid, integer, bytea, bytea, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_source_session_rotate(uuid, integer, bytea, bytea, text, timestamptz) TO service_role;
