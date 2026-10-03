-- Function: public.get_production_equipment_cleaning_admin
-- Returns equipment cleaning/sanitation records
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_equipment_cleaning_admin(
  p_equipment_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  equipment_id uuid,
  cleaning_method text,
  cleaning_agent text,
  performed_at timestamptz,
  performed_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  swab_results jsonb,
  visual_inspection text,
  status text,
  batch_id_before uuid,
  batch_id_after uuid,
  notes text,
  metadata jsonb,
  created_at timestamptz
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
    p_entity_id := p_equipment_id::text,
    p_entity_type := 'production_equipment_cleaning',
    p_new_values := jsonb_build_object('equipment_id', p_equipment_id, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production equipment cleaning',
    p_tags := ARRAY['admin', 'production_equipment_cleaning'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pecl.id, pecl.equipment_id, pecl.cleaning_method, pecl.cleaning_agent,
    pecl.performed_at, pecl.performed_by, pecl.verified_by, pecl.verified_at,
    pecl.swab_results, pecl.visual_inspection, pecl.status,
    pecl.batch_id_before, pecl.batch_id_after,
    pecl.notes, pecl.metadata, pecl.created_at
  FROM public.production_equipment_cleaning pecl
  WHERE (p_equipment_id IS NULL OR pecl.equipment_id = p_equipment_id)
    AND (p_status IS NULL OR pecl.status = p_status)
  ORDER BY pecl.performed_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_equipment_cleaning_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_equipment_cleaning_admin(uuid, text) TO authenticated;
