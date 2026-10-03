-- Function: public.upsert_production_qc_test_definition_admin
-- Creates or updates a QC test specification
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_qc_test_definition_admin(
  p_applicable_products text[] DEFAULT NULL,
  p_applicable_steps text[] DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_frequency text DEFAULT 'per_batch',
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_method_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_sampling_plan jsonb DEFAULT NULL,
  p_spec_limit_high numeric DEFAULT NULL,
  p_spec_limit_low numeric DEFAULT NULL,
  p_target_value numeric DEFAULT NULL,
  p_test_code text DEFAULT NULL,
  p_test_name text DEFAULT NULL,
  p_units text DEFAULT NULL,
  p_version text DEFAULT '1.0'
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

  IF p_test_code IS NULL OR p_test_name IS NULL THEN
    RAISE EXCEPTION 'test_code and test_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_qc_test_definitions SET
      test_code = p_test_code,
      test_name = p_test_name,
      method_ref = p_method_ref,
      description = p_description,
      units = p_units,
      spec_limit_low = p_spec_limit_low,
      spec_limit_high = p_spec_limit_high,
      target_value = p_target_value,
      sampling_plan = p_sampling_plan,
      applicable_products = p_applicable_products,
      applicable_steps = p_applicable_steps,
      frequency = p_frequency,
      version = p_version,
      is_active = p_is_active,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_qc_test_definitions (
      test_code, test_name, method_ref, description, units,
      spec_limit_low, spec_limit_high, target_value,
      sampling_plan, applicable_products, applicable_steps,
      frequency, version, is_active, notes, metadata, created_by
    ) VALUES (
      p_test_code, p_test_name, p_method_ref, p_description, p_units,
      p_spec_limit_low, p_spec_limit_high, p_target_value,
      p_sampling_plan, p_applicable_products, p_applicable_steps,
      p_frequency, p_version, p_is_active, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_qc_test_definition',
    p_new_values := jsonb_build_object('test_code', p_test_code, 'version', p_version),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s QC test definition %s v%s', v_action, p_test_code, p_version),
    p_tags := ARRAY['admin', 'production_qc_test_definition'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_qc_test_definition_admin(text[][], text[][], text, text, uuid, boolean, jsonb, text, text, jsonb, numeric, numeric, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_qc_test_definition_admin(text[][], text[][], text, text, uuid, boolean, jsonb, text, text, jsonb, numeric, numeric, numeric, text, text, text, text) TO authenticated;
