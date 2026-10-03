-- Function: public.cleanup_old_rate_limits
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:59+01:00

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Stráž (ADR-004, 2026-09-25): SECURITY DEFINER úklid smí jen servis (plánovač brokeru
  -- ho volá v tiku údržby federace pod advisory lockem) nebo admin/staff. Dřív ho mohl
  -- volat kdokoli přihlášený a servisní role naopak NE (grant jen authenticated) —
  -- úklid proto nevolal nikdo a funkce stála v security-known-issues.
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api_rate_limits
  WHERE window_end < now() - INTERVAL '1 hour';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits() TO service_role;
