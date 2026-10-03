-- Function: public.create_dosing_log
-- Arguments: p_product_id uuid, p_dose_amount text, p_dose_count integer, p_dose_unit text, p_study_registration_id uuid, p_taken_with_food boolean, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:03+01:00

CREATE OR REPLACE FUNCTION public.create_dosing_log(p_product_id uuid, p_dose_amount text DEFAULT NULL::text, p_dose_count integer DEFAULT 1, p_dose_unit text DEFAULT 'capsule'::text, p_study_registration_id uuid DEFAULT NULL::uuid, p_taken_with_food boolean DEFAULT NULL::boolean, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_new_id uuid;
  v_result jsonb;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Insert new dosing log
  INSERT INTO dosing_logs (
    user_id,
    product_id,
    study_registration_id,
    dose_amount,
    dose_count,
    dose_unit,
    taken_with_food,
    notes
  ) VALUES (
    v_user_id,
    p_product_id,
    p_study_registration_id,
    p_dose_amount,
    p_dose_count,
    p_dose_unit,
    p_taken_with_food,
    p_notes
  )
  RETURNING id INTO v_new_id;

  -- Log the creation
  INSERT INTO audit_journal (
    entity_type,
    entity_id,
    action,
    user_id,
    new_data
  ) VALUES (
    'dosing_logs',
    v_new_id,
    'INSERT',
    v_user_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'dose_count', p_dose_count
    )
  );

  -- Return the created record
  SELECT jsonb_build_object(
    'id', d.id,
    'user_id', d.user_id,
    'product_id', d.product_id,
    'study_registration_id', d.study_registration_id,
    'logged_at', d.logged_at,
    'dose_amount', d.dose_amount,
    'dose_unit', d.dose_unit,
    'dose_count', d.dose_count,
    'taken_with_food', d.taken_with_food,
    'notes', d.notes,
    'created_at', d.created_at
  ) INTO v_result
  FROM dosing_logs d
  WHERE d.id = v_new_id;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_dosing_log(p_product_id uuid, p_dose_amount text, p_dose_count integer, p_dose_unit text, p_study_registration_id uuid, p_taken_with_food boolean, p_notes text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_dosing_log(p_product_id uuid, p_dose_amount text, p_dose_count integer, p_dose_unit text, p_study_registration_id uuid, p_taken_with_food boolean, p_notes text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_dosing_log(p_product_id uuid, p_dose_amount text, p_dose_count integer, p_dose_unit text, p_study_registration_id uuid, p_taken_with_food boolean, p_notes text) TO authenticated;
