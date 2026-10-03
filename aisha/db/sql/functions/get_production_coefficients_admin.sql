-- Function: public.get_production_coefficients_admin
-- Returns process coefficients with optional product filter
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_coefficients_admin(
  p_product text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  product text,
  coefficient_name text,
  symbol text,
  value numeric,
  unit text,
  definition text,
  source text,
  confidence text,
  valid_from date,
  valid_to date,
  is_active boolean,
  notes text,
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
    p_entity_id := NULL,
    p_entity_type := 'production_coefficient',
    p_new_values := jsonb_build_object('product', p_product),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production coefficients',
    p_tags := ARRAY['admin', 'production_coefficient'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pc.id, pc.product, pc.coefficient_name, pc.symbol,
    pc.value, pc.unit, pc.definition, pc.source, pc.confidence,
    pc.valid_from, pc.valid_to, pc.is_active, pc.notes,
    pc.created_at, pc.updated_at
  FROM public.production_coefficients pc
  WHERE (p_product IS NULL OR pc.product = p_product)
    AND pc.is_active = true
    AND (pc.valid_to IS NULL OR pc.valid_to >= CURRENT_DATE)
  ORDER BY pc.product, pc.coefficient_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_coefficients_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_coefficients_admin(text) TO authenticated;
