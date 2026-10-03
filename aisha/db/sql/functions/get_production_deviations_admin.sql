-- Function: public.get_production_deviations_admin
-- Returns deviation/investigation records
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_deviations_admin(
  p_batch_id uuid DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  deviation_number text,
  batch_id uuid,
  step_id uuid,
  equipment_id uuid,
  lot_id uuid,
  severity text,
  category text,
  title text,
  description text,
  root_cause text,
  immediate_action text,
  disposition text,
  status text,
  initiated_at timestamptz,
  initiated_by uuid,
  investigated_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
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
    p_entity_type := 'production_deviation',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'severity', p_severity, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production deviations',
    p_tags := ARRAY['admin', 'production_deviation'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pd.id, pd.deviation_number, pd.batch_id, pd.step_id,
    pd.equipment_id, pd.lot_id, pd.severity, pd.category,
    pd.title, pd.description, pd.root_cause, pd.immediate_action,
    pd.disposition, pd.status, pd.initiated_at, pd.initiated_by,
    pd.investigated_by, pd.resolved_at, pd.resolved_by,
    pd.approved_by, pd.approved_at, pd.notes, pd.metadata,
    pd.created_at, pd.updated_at
  FROM public.production_deviations pd
  WHERE (p_batch_id IS NULL OR pd.batch_id = p_batch_id)
    AND (p_severity IS NULL OR pd.severity = p_severity)
    AND (p_status IS NULL OR pd.status = p_status)
  ORDER BY pd.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_deviations_admin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_deviations_admin(uuid, text, text) TO authenticated;
