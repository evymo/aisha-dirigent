-- Function: public.get_production_quality_params_admin
-- Returns QC parameters for a batch
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_quality_params_admin(
  p_batch_id uuid DEFAULT NULL,
  p_result text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  batch_id uuid,
  step_seq integer,
  parameter text,
  value numeric,
  value_text text,
  uom text,
  limit_low numeric,
  limit_high numeric,
  method text,
  result text,
  measured_at timestamptz,
  measured_by uuid,
  notes text,
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
    p_entity_id := p_batch_id::text,
    p_entity_type := 'production_quality',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'result', p_result),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production quality params',
    p_tags := ARRAY['admin', 'production_quality'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pqp.id, pqp.batch_id, pqp.step_seq, pqp.parameter,
    pqp.value, pqp.value_text, pqp.uom,
    pqp.limit_low, pqp.limit_high, pqp.method,
    pqp.result, pqp.measured_at, pqp.measured_by,
    pqp.notes, pqp.created_at
  FROM public.production_quality_params pqp
  WHERE (p_batch_id IS NULL OR pqp.batch_id = p_batch_id)
    AND (p_result IS NULL OR pqp.result = p_result)
  ORDER BY pqp.batch_id, pqp.step_seq, pqp.parameter;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_quality_params_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_quality_params_admin(uuid, text) TO authenticated;
