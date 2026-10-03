-- ============================================================================
-- Source of truth: federated_source_session_get_for_caller
-- Vrátí šifrový text AKTIVNÍ relace uživatele u zdroje (ADR-004). JEN servisní role.
-- Odvolaná nebo prošlá relace se nevrací: volání „za uživatele" pak skončí
-- „připoj účet", NIKDY tichým pádem na servisní účet (revize rady B5).
-- Každé čtení šifrového textu = řádek auditu bez hodnot (broker čte jednou za
-- naplnění své paměti; platnost ověřuje levnou `…_version` bez šifrového textu).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_get_for_caller(p_user_id uuid, p_provider text)
RETURNS TABLE (source_session_id uuid, version integer, provider_id text, token_ct bytea, refresh_ct bytea, key_id text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.version, s.provider_id, s.token_ct, s.refresh_ct, s.key_id, s.expires_at
    INTO r
    FROM public.federated_source_sessions s
   WHERE s.user_id = p_user_id AND s.provider = p_provider
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
  VALUES ((SELECT u.id FROM aisha_auth.users u WHERE u.id = p_user_id), 'federace.relace_ctena', 'federace.relace_ctena', 'security', 'info',
          'federated_source_session', r.id::text, jsonb_build_object('provider', p_provider, 'version', r.version, 'uzivatel', p_user_id));
  RETURN QUERY SELECT r.id, r.version, r.provider_id, r.token_ct, r.refresh_ct, r.key_id, r.expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_get_for_caller(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_source_session_get_for_caller(uuid, text) TO service_role;
