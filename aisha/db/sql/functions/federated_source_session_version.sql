-- ============================================================================
-- Source of truth: federated_source_session_version
-- Levná kontrola platnosti relace BEZ šifrového textu (ADR-004, bod 5; revize S2).
-- Broker smí držet dešifrovaný token v paměti procesu, ale při KAŽDÉM použití se
-- zeptá tady: odvolání i nahrazení relace tak platí okamžitě i napříč replikami.
-- Nečte tajemství → žádný zápis auditu (čtecí cesta).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_version(p_user_id uuid, p_provider text)
RETURNS TABLE (source_session_id uuid, version integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.version
      FROM public.federated_source_sessions s
     WHERE s.user_id = p_user_id AND s.provider = p_provider
       AND s.revoked_at IS NULL AND s.expires_at > now();
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_version(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_source_session_version(uuid, text) TO service_role;
