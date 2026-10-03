-- Function: public.get_production_cost_overview_admin
-- Returns cost scenarios with their line items for admin dashboard
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_cost_overview_admin(
  p_batch_id uuid DEFAULT NULL,
  p_scenario_code text DEFAULT NULL
)
RETURNS TABLE(
  scenario_id uuid,
  scenario_code text,
  scenario_name text,
  output_qty_mg numeric,
  cost_line_id uuid,
  cost_element text,
  bucket_code text,
  amount numeric,
  basis text,
  source text,
  notes text
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
    p_entity_id := COALESCE(p_batch_id::text, p_scenario_code),
    p_entity_type := 'production_cost',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'scenario_code', p_scenario_code),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production cost overview',
    p_tags := ARRAY['admin', 'production_cost'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pcs.id AS scenario_id,
    pcs.scenario_code,
    pcs.scenario_name,
    pcs.output_qty_mg,
    pcl.id AS cost_line_id,
    pcl.cost_element,
    pcl.bucket_code,
    pcl.amount,
    pcl.basis,
    pcl.source,
    pcl.notes
  FROM public.production_cost_scenarios pcs
  LEFT JOIN public.production_cost_lines pcl ON pcl.scenario_id = pcs.id
  WHERE (p_scenario_code IS NULL OR pcs.scenario_code = p_scenario_code)
    AND (p_batch_id IS NULL OR pcl.batch_id = p_batch_id)
    AND pcs.is_active = true
  ORDER BY pcs.scenario_code, pcl.bucket_code, pcl.cost_element;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_cost_overview_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_cost_overview_admin(uuid, text) TO authenticated;
