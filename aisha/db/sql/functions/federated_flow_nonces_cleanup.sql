-- ============================================================================
-- Source of truth: federated_flow_nonces_cleanup
-- Smaže prošlá nonce přihlašovacího toku. Volá plánovač brokeru (scheduler.ts) pod
-- advisory lockem, ve stejném tiku jako cleanup_old_rate_limits(). JEN servisní role.
-- Prošlé nonce už přehrát nejde (federated_flow_nonce_use odmítá prošlé), takže
-- mazání jednorázovost neoslabí.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_flow_nonces_cleanup()
RETURNS integer
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
  DELETE FROM public.federated_flow_nonces WHERE expires_at < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_flow_nonces_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_flow_nonces_cleanup() TO service_role;
