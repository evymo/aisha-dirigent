-- Function: public.get_production_cost_rates_admin
-- Returns cost rates, optionally filtered to currently valid rates
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_cost_rates_admin(
  p_cost_element_code text DEFAULT NULL,
  p_current_only boolean DEFAULT true
)
RETURNS TABLE(
  id uuid,
  cost_element_code text,
  cost_element_name text,
  cost_group text,
  rate numeric,
  uom text,
  valid_from date,
  valid_to date,
  is_active boolean,
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
    p_entity_id := NULL,
    p_entity_type := 'production_cost_rate',
    p_new_values := jsonb_build_object('cost_element_code', p_cost_element_code),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production cost rates',
    p_tags := ARRAY['admin', 'production_cost_rate'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pcr.id, pcr.cost_element_code, pcr.cost_element_name,
    pcr.cost_group, pcr.rate, pcr.uom,
    pcr.valid_from, pcr.valid_to, pcr.is_active,
    pcr.notes, pcr.created_at
  FROM public.production_cost_rates pcr
  WHERE (p_cost_element_code IS NULL OR pcr.cost_element_code = p_cost_element_code)
    AND pcr.is_active = true
    AND (
      NOT p_current_only
      OR (pcr.valid_from <= CURRENT_DATE AND (pcr.valid_to IS NULL OR pcr.valid_to >= CURRENT_DATE))
    )
  ORDER BY pcr.cost_element_code, pcr.valid_from;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_cost_rates_admin(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_cost_rates_admin(text, boolean) TO authenticated;
