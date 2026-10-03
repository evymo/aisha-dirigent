-- Function: public.get_production_equipment_admin
-- Returns production equipment/assets
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_equipment_admin(
  p_gmp_criticality text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_qualification_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  asset_tag text,
  equipment_name text,
  model text,
  serial_no text,
  manufacturer text,
  resource_id uuid,
  location_id uuid,
  gmp_criticality text,
  qualification_status text,
  last_qualified_at timestamptz,
  next_qualification_due date,
  power_kw numeric,
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
    p_entity_type := 'production_equipment',
    p_new_values := jsonb_build_object('gmp_criticality', p_gmp_criticality, 'location_id', p_location_id),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production equipment',
    p_tags := ARRAY['admin', 'production_equipment'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pe.id, pe.asset_tag, pe.equipment_name, pe.model, pe.serial_no,
    pe.manufacturer, pe.resource_id, pe.location_id, pe.gmp_criticality,
    pe.qualification_status, pe.last_qualified_at, pe.next_qualification_due,
    pe.power_kw, pe.is_active, pe.notes, pe.metadata,
    pe.created_at, pe.updated_at, pe.created_by
  FROM public.production_equipment pe
  WHERE (p_gmp_criticality IS NULL OR pe.gmp_criticality = p_gmp_criticality)
    AND (p_location_id IS NULL OR pe.location_id = p_location_id)
    AND (p_qualification_status IS NULL OR pe.qualification_status = p_qualification_status)
  ORDER BY pe.asset_tag;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_equipment_admin(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_equipment_admin(text, uuid, text) TO authenticated;
