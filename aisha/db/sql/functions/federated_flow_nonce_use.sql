-- ============================================================================
-- Source of truth: federated_flow_nonce_use
-- Spotřebuje nonce stavu přihlašovacího toku (ADR-004, bod 4; revize V1, B10).
-- true = první použití; false = přehrání (stav už byl použit) nebo prošlý stav.
-- Evidence v DB → jednorázovost platí napříč replikami brokeru. JEN servisní role.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_flow_nonce_use(p_nonce text, p_user_id uuid, p_provider text, p_expires_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_nonce IS NULL OR length(p_nonce) < 16 OR p_user_id IS NULL OR coalesce(btrim(p_provider), '') = '' THEN
    RAISE EXCEPTION 'FEDERATED_FLOW_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RETURN false;
  END IF;
  INSERT INTO public.federated_flow_nonces (nonce, user_id, provider, expires_at)
  VALUES (p_nonce, p_user_id, p_provider, p_expires_at)
  ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_flow_nonce_use(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_flow_nonce_use(text, uuid, text, timestamptz) TO service_role;
