-- Function: public.get_production_qc_test_definitions_admin
-- Returns QC test specification master data
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_qc_test_definitions_admin(
  p_frequency text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  test_code text,
  test_name text,
  method_ref text,
  description text,
  units text,
  spec_limit_low numeric,
  spec_limit_high numeric,
  target_value numeric,
  sampling_plan jsonb,
  applicable_products text[],
  applicable_steps text[],
  frequency text,
  version text,
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
    p_entity_type := 'production_qc_test_definition',
    p_new_values := jsonb_build_object('frequency', p_frequency, 'is_active', p_is_active),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production QC test definitions',
    p_tags := ARRAY['admin', 'production_qc_test_definition'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pqd.id, pqd.test_code, pqd.test_name, pqd.method_ref,
    pqd.description, pqd.units, pqd.spec_limit_low, pqd.spec_limit_high,
    pqd.target_value, pqd.sampling_plan, pqd.applicable_products,
    pqd.applicable_steps, pqd.frequency, pqd.version,
    pqd.is_active, pqd.notes, pqd.metadata,
    pqd.created_at, pqd.updated_at, pqd.created_by
  FROM public.production_qc_test_definitions pqd
  WHERE (p_frequency IS NULL OR pqd.frequency = p_frequency)
    AND (p_is_active IS NULL OR pqd.is_active = p_is_active)
  ORDER BY pqd.test_code, pqd.version;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_qc_test_definitions_admin(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_qc_test_definitions_admin(text, boolean) TO authenticated;
