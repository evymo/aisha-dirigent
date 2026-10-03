-- ============================================================================
-- Source of truth: enforce_rate_limit_for
-- Servisní varianta enforce_rate_limit nad TOUŽ tabulkou api_rate_limits (ADR-004,
-- bod 4; revize B4: connect je jinak orákulum hesel proti zdroji).
--
-- ⛔ PROČ NE enforce_rate_limit: ta počítá podle auth.uid() a BEZ něj tiše
-- propustí (RETURN) — pro broker, který volá jako servis, by limitovala naoko.
-- Tahle je FAIL-CLOSED: chybějící nebo neexistující uživatel = výjimka, ne průchod.
-- Stav je v DB → limit platí napříč replikami brokeru (paměť procesu by se násobila).
-- Úklid: cleanup_old_rate_limits() v tiku plánovače brokeru. JEN servisní role.
-- Překročení = výjimka 'RATE_LIMIT_EXCEEDED' (SQLSTATE P0429), broker ji mapuje na 429.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_rate_limit_for(p_user_id uuid, p_endpoint_key text, p_window_ms integer, p_max_requests integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
  v_count integer;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR coalesce(btrim(p_endpoint_key), '') = ''
     OR coalesce(p_window_ms, 0) <= 0 OR coalesce(p_max_requests, 0) <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'RATE_LIMIT_UNKNOWN_USER' USING ERRCODE = '22023';
  END IF;
  -- Souběžné požadavky téhož klíče (i z víc replik) serializovat, jinak dva INSERTy
  -- vyrobí dvě okna a limit se zdvojí.
  PERFORM pg_advisory_xact_lock(hashtext('api_rate_limits'), hashtext(p_user_id::text || '|' || p_endpoint_key));
  SELECT id, request_count INTO v_id, v_count
    FROM public.api_rate_limits
   WHERE user_id = p_user_id AND endpoint_key = p_endpoint_key AND window_end > now()
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.api_rate_limits SET request_count = request_count + 1, updated_at = now() WHERE id = v_id;
    v_count := v_count + 1;
  ELSE
    DELETE FROM public.api_rate_limits WHERE user_id = p_user_id AND endpoint_key = p_endpoint_key;
    INSERT INTO public.api_rate_limits (user_id, endpoint_key, request_count, window_start, window_end)
    VALUES (p_user_id, p_endpoint_key, 1, now(), now() + (p_window_ms || ' milliseconds')::interval);
    v_count := 1;
  END IF;
  IF v_count > p_max_requests THEN
    RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED' USING ERRCODE = 'P0429';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_rate_limit_for(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_rate_limit_for(uuid, text, integer, integer) TO service_role;
