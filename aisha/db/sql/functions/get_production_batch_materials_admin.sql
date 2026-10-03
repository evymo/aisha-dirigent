-- Function: public.get_production_batch_materials_admin
-- Returns actual material consumption/output per batch step with lot traceability
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_batch_materials_admin(
  p_batch_id uuid DEFAULT NULL,
  p_direction text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  batch_id uuid,
  step_id uuid,
  lot_id uuid,
  item_id uuid,
  direction text,
  planned_qty numeric,
  actual_qty numeric,
  uom text,
  variance_pct numeric,
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
    p_entity_id := p_batch_id::text,
    p_entity_type := 'production_batch_material',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'direction', p_direction),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production batch materials',
    p_tags := ARRAY['admin', 'production_batch_material'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pbm.id, pbm.batch_id, pbm.step_id, pbm.lot_id, pbm.item_id,
    pbm.direction, pbm.planned_qty, pbm.actual_qty, pbm.uom,
    pbm.variance_pct, pbm.notes, pbm.metadata,
    pbm.created_at, pbm.updated_at, pbm.created_by
  FROM public.production_batch_materials pbm
  WHERE (p_batch_id IS NULL OR pbm.batch_id = p_batch_id)
    AND (p_direction IS NULL OR pbm.direction = p_direction)
  ORDER BY pbm.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_batch_materials_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_batch_materials_admin(uuid, text) TO authenticated;
