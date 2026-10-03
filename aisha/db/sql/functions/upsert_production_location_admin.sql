-- Function: public.upsert_production_location_admin
-- Creates or updates a production location
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_location_admin(
  p_address jsonb DEFAULT NULL,
  p_gmp_zone text DEFAULT NULL,
  p_humidity_range_max numeric DEFAULT NULL,
  p_humidity_range_min numeric DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_location_code text DEFAULT NULL,
  p_location_name text DEFAULT NULL,
  p_location_type text DEFAULT 'plant',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_parent_location_id uuid DEFAULT NULL,
  p_temp_range_max numeric DEFAULT NULL,
  p_temp_range_min numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
  v_action text;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_location_code IS NULL OR p_location_name IS NULL THEN
    RAISE EXCEPTION 'location_code and location_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_locations SET
      location_code = p_location_code,
      location_name = p_location_name,
      location_type = p_location_type,
      address = p_address,
      gmp_zone = p_gmp_zone,
      temp_range_min = p_temp_range_min,
      temp_range_max = p_temp_range_max,
      humidity_range_min = p_humidity_range_min,
      humidity_range_max = p_humidity_range_max,
      parent_location_id = p_parent_location_id,
      is_active = p_is_active,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_locations (
      location_code, location_name, location_type, address,
      gmp_zone, temp_range_min, temp_range_max,
      humidity_range_min, humidity_range_max,
      parent_location_id, is_active, notes, metadata, created_by
    ) VALUES (
      p_location_code, p_location_name, p_location_type, p_address,
      p_gmp_zone, p_temp_range_min, p_temp_range_max,
      p_humidity_range_min, p_humidity_range_max,
      p_parent_location_id, p_is_active, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_location',
    p_new_values := jsonb_build_object('location_code', p_location_code, 'location_type', p_location_type),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production location %s', v_action, p_location_code),
    p_tags := ARRAY['admin', 'production_location'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_location_admin(jsonb, text, numeric, numeric, uuid, boolean, text, text, text, jsonb, text, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_location_admin(jsonb, text, numeric, numeric, uuid, boolean, text, text, text, jsonb, text, uuid, numeric, numeric) TO authenticated;
