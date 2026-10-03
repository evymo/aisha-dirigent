-- Function: public.upsert_distribution_protocol_admin
-- Arguments: p_arm_code text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text, p_dose_amount numeric DEFAULT NULL::numeric, p_dose_timing text[] DEFAULT NULL::text[], p_dose_unit text DEFAULT NULL::text, p_doses_per_day integer DEFAULT NULL::integer, p_id uuid DEFAULT NULL::uuid, p_is_active boolean DEFAULT NULL::boolean, p_name text DEFAULT NULL::text, p_name_key text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid, p_study_id uuid DEFAULT NULL::uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.upsert_distribution_protocol_admin(p_arm_code text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text, p_dose_amount numeric DEFAULT NULL::numeric, p_dose_timing text[] DEFAULT NULL::text[], p_dose_unit text DEFAULT NULL::text, p_doses_per_day integer DEFAULT NULL::integer, p_id uuid DEFAULT NULL::uuid, p_is_active boolean DEFAULT NULL::boolean, p_name text DEFAULT NULL::text, p_name_key text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid, p_study_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE distribution_protocols SET
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      name_key = COALESCE(p_name_key, name_key),
      description_key = COALESCE(p_description_key, description_key),
      study_id = COALESCE(p_study_id, study_id),
      product_id = COALESCE(p_product_id, product_id),
      dose_amount = COALESCE(p_dose_amount, dose_amount),
      dose_unit = COALESCE(p_dose_unit, dose_unit),
      doses_per_day = COALESCE(p_doses_per_day, doses_per_day),
      dose_timing = COALESCE(p_dose_timing, dose_timing),
      arm_code = COALESCE(p_arm_code, arm_code),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO distribution_protocols (
      name, description, name_key, description_key,
      study_id, product_id, dose_amount, dose_unit,
      doses_per_day, dose_timing, arm_code, is_active
    ) VALUES (
      COALESCE(p_name, ''),
      p_description,
      p_name_key,
      p_description_key,
      p_study_id,
      p_product_id,
      COALESCE(p_dose_amount, 0),
      COALESCE(p_dose_unit, 'drops'),
      COALESCE(p_doses_per_day, 1),
      COALESCE(p_dose_timing, ARRAY['morning']::text[]),
      p_arm_code,
      COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_id;
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'health'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_product_id::text,
      p_entity_type := 'distribution_protocol',
      p_new_values := jsonb_build_object('arm_code', p_arm_code, 'description', p_description, 'description_key', p_description_key, 'dose_amount', p_dose_amount, 'dose_timing', p_dose_timing),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated distribution protocol',
      p_tags := ARRAY['admin', 'distribution_protocol', 'update'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_distribution_protocol_admin(text, text, text, numeric, text[][], text, integer, uuid, boolean, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_distribution_protocol_admin(text, text, text, numeric, text[][], text, integer, uuid, boolean, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_distribution_protocol_admin(text, text, text, numeric, text[][], text, integer, uuid, boolean, text, text, uuid, uuid) TO service_role;
