-- Function: public.upsert_production_coefficient_admin
-- Creates or updates a production coefficient
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_coefficient_admin(
  p_coefficient_name text DEFAULT NULL,
  p_confidence text DEFAULT 'measured',
  p_definition text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_notes text DEFAULT NULL,
  p_product text DEFAULT NULL,
  p_source text DEFAULT 'measured',
  p_symbol text DEFAULT NULL,
  p_unit text DEFAULT NULL,
  p_valid_from date DEFAULT NULL,
  p_valid_to date DEFAULT NULL,
  p_value numeric DEFAULT NULL
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

  IF p_product IS NULL OR p_coefficient_name IS NULL OR p_value IS NULL THEN
    RAISE EXCEPTION 'product, coefficient_name, and value are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_coefficients SET
      product = p_product,
      coefficient_name = p_coefficient_name,
      symbol = p_symbol,
      value = p_value,
      unit = p_unit,
      definition = p_definition,
      source = p_source,
      confidence = p_confidence,
      valid_from = p_valid_from,
      valid_to = p_valid_to,
      is_active = p_is_active,
      notes = p_notes,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_coefficients (
      product, coefficient_name, symbol, value, unit, definition,
      source, confidence, valid_from, valid_to, is_active, notes, created_by
    ) VALUES (
      p_product, p_coefficient_name, p_symbol, p_value, p_unit, p_definition,
      p_source, p_confidence, p_valid_from, p_valid_to, p_is_active, p_notes, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_coefficient',
    p_new_values := jsonb_build_object('product', p_product, 'coefficient_name', p_coefficient_name),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production coefficient %s.%s', v_action, p_product, p_coefficient_name),
    p_tags := ARRAY['admin', 'production_coefficient'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_coefficient_admin(text, text, text, uuid, boolean, text, text, text, text, text, date, date, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_coefficient_admin(text, text, text, uuid, boolean, text, text, text, text, text, date, date, numeric) TO authenticated;
