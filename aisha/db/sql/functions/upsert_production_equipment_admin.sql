-- Function: public.upsert_production_equipment_admin
-- Creates or updates a production equipment/asset
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_equipment_admin(
  p_asset_tag text DEFAULT NULL,
  p_equipment_name text DEFAULT NULL,
  p_gmp_criticality text DEFAULT 'standard',
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_location_id uuid DEFAULT NULL,
  p_manufacturer text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_model text DEFAULT NULL,
  p_next_qualification_due date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_power_kw numeric DEFAULT NULL,
  p_qualification_status text DEFAULT 'pending',
  p_resource_id uuid DEFAULT NULL,
  p_serial_no text DEFAULT NULL
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

  IF p_asset_tag IS NULL OR p_equipment_name IS NULL THEN
    RAISE EXCEPTION 'asset_tag and equipment_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_equipment SET
      asset_tag = p_asset_tag,
      equipment_name = p_equipment_name,
      model = p_model,
      serial_no = p_serial_no,
      manufacturer = p_manufacturer,
      resource_id = p_resource_id,
      location_id = p_location_id,
      gmp_criticality = p_gmp_criticality,
      qualification_status = p_qualification_status,
      last_qualified_at = CASE WHEN p_qualification_status = 'qualified' AND qualification_status != 'qualified' THEN now() ELSE last_qualified_at END,
      next_qualification_due = p_next_qualification_due,
      power_kw = p_power_kw,
      is_active = p_is_active,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_equipment (
      asset_tag, equipment_name, model, serial_no, manufacturer,
      resource_id, location_id, gmp_criticality, qualification_status,
      next_qualification_due, power_kw, is_active, notes, metadata, created_by
    ) VALUES (
      p_asset_tag, p_equipment_name, p_model, p_serial_no, p_manufacturer,
      p_resource_id, p_location_id, p_gmp_criticality, p_qualification_status,
      p_next_qualification_due, p_power_kw, p_is_active, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_equipment',
    p_new_values := jsonb_build_object('asset_tag', p_asset_tag, 'gmp_criticality', p_gmp_criticality),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production equipment %s', v_action, p_asset_tag),
    p_tags := ARRAY['admin', 'production_equipment'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_equipment_admin(text, text, text, uuid, boolean, uuid, text, jsonb, text, date, text, numeric, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_equipment_admin(text, text, text, uuid, boolean, uuid, text, jsonb, text, date, text, numeric, text, uuid, text) TO authenticated;
