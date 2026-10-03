-- Function: public.get_production_locations_admin
-- Returns production locations (facility/warehouse master)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_locations_admin(
  p_location_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  location_code text,
  location_name text,
  location_type text,
  address jsonb,
  gmp_zone text,
  temp_range_min numeric,
  temp_range_max numeric,
  humidity_range_min numeric,
  humidity_range_max numeric,
  parent_location_id uuid,
  is_active boolean,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := NULL,
    p_entity_type := 'production_location',
    p_new_values := jsonb_build_object('location_type', p_location_type),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production locations',
    p_tags := ARRAY['admin', 'production_location'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pl.id, pl.location_code, pl.location_name, pl.location_type,
    pl.address, pl.gmp_zone, pl.temp_range_min, pl.temp_range_max,
    pl.humidity_range_min, pl.humidity_range_max, pl.parent_location_id,
    pl.is_active, pl.notes, pl.metadata, pl.created_at, pl.updated_at,
    pl.created_by
  FROM public.production_locations pl
  WHERE (p_location_type IS NULL OR pl.location_type = p_location_type)
  ORDER BY pl.location_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_locations_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_locations_admin(text) TO authenticated;
