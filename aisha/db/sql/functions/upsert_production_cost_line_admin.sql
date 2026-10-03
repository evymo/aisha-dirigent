-- Function: public.upsert_production_cost_line_admin
-- Creates or updates a cost line item
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_cost_line_admin(
  p_amount numeric DEFAULT 0,
  p_basis text DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_bucket_code text DEFAULT NULL,
  p_cost_element text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_scenario_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL
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

  IF p_cost_element IS NULL THEN
    RAISE EXCEPTION 'cost_element is required';
  END IF;

  IF p_batch_id IS NULL AND p_scenario_id IS NULL THEN
    RAISE EXCEPTION 'Either batch_id or scenario_id must be provided';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_cost_lines SET
      batch_id = p_batch_id,
      scenario_id = p_scenario_id,
      cost_element = p_cost_element,
      bucket_code = p_bucket_code,
      amount = p_amount,
      basis = p_basis,
      source = p_source,
      notes = p_notes,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_cost_lines (
      batch_id, scenario_id, cost_element, bucket_code,
      amount, basis, source, notes, created_by
    ) VALUES (
      p_batch_id, p_scenario_id, p_cost_element, p_bucket_code,
      p_amount, p_basis, p_source, p_notes, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_cost_line',
    p_new_values := jsonb_build_object('cost_element', p_cost_element, 'amount', p_amount),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s cost line %s', v_action, p_cost_element),
    p_tags := ARRAY['admin', 'production_cost'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_cost_line_admin(numeric, text, uuid, text, text, uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_cost_line_admin(numeric, text, uuid, text, text, uuid, text, uuid, text) TO authenticated;
