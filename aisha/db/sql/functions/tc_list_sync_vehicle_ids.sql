-- ============================================================================
-- Source of Truth: tc_list_sync_vehicle_ids
-- Popis: Seznam aktivních vozidel pro sync_rides (kniha jízd se tahá per
--        vozidlo). Doplněno 2026-07-25: sync.ts tuto RPC volal, ale v SoT
--        chyběla — bez ní neběžel žádný import knihy jízd.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_list_sync_vehicle_ids()
RETURNS TABLE (tc_vehicle_id integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  RETURN QUERY
  SELECT v.tc_vehicle_id
  FROM public.tc_vehicles v
  WHERE v.active
  ORDER BY v.tc_vehicle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.tc_list_sync_vehicle_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tc_list_sync_vehicle_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tc_list_sync_vehicle_ids() TO service_role;
