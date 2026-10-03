-- ============================================================================
-- Source of Truth: wd_list_sync_vehicle_ids
-- Popis: Seznam wd_car_id aktivních vozidel pro per-vozidlo sync
--        (kniha jízd _getCarLogBook4 se volá po jednom vozidle).
--        Volá svc-webdispecink před importem jízd.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; read-only (STABLE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_list_sync_vehicle_ids()
RETURNS TABLE (wd_car_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  RETURN QUERY
  SELECT v.wd_car_id
  FROM public.wd_vehicles v
  WHERE v.active = true
  ORDER BY v.wd_car_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wd_list_sync_vehicle_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_list_sync_vehicle_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_list_sync_vehicle_ids() TO service_role;
