-- Function: public.create_dosing_log_audited
-- Arguments: p_distribution_protocol_id uuid, p_product_id uuid, p_study_registration_id uuid, p_dose_amount text, p_dose_unit text, p_dose_count integer, p_dose_timing text[], p_is_custom_distribution boolean, p_report_type text, p_report_period_start date, p_report_period_end date, p_taken_with_food boolean, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:03+01:00

CREATE OR REPLACE FUNCTION public.create_dosing_log_audited(p_distribution_protocol_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_study_registration_id uuid DEFAULT NULL::uuid, p_dose_amount text DEFAULT NULL::text, p_dose_unit text DEFAULT 'drops'::text, p_dose_count integer DEFAULT 1, p_dose_timing text[] DEFAULT NULL::text[], p_is_custom_distribution boolean DEFAULT false, p_report_type text DEFAULT 'daily'::text, p_report_period_start date DEFAULT NULL::date, p_report_period_end date DEFAULT NULL::date, p_taken_with_food boolean DEFAULT NULL::boolean, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify registration belongs to user if provided
  IF p_study_registration_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM study_registrations 
      WHERE id = p_study_registration_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Invalid study registration' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO dosing_logs (
    user_id, distribution_protocol_id, product_id, study_registration_id,
    dose_amount, dose_unit, dose_count, is_custom_distribution,
    report_type, report_period_start, report_period_end,
    taken_with_food, notes, logged_at
  ) VALUES (
    v_user_id, p_distribution_protocol_id, p_product_id, p_study_registration_id,
    p_dose_amount, p_dose_unit, p_dose_count, p_is_custom_distribution,
    p_report_type, p_report_period_start, p_report_period_end,
    p_taken_with_food, p_notes, now()
  )
  RETURNING id INTO v_id;

  -- Log audit
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'health'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'dosing_log',
      p_severity := 'info'::journal_severity,
      p_summary := 'Dosing log created',
    p_user_id := v_user_id
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_dosing_log_audited(p_distribution_protocol_id uuid, p_product_id uuid, p_study_registration_id uuid, p_dose_amount text, p_dose_unit text, p_dose_count integer, p_dose_timing text[], p_is_custom_distribution boolean, p_report_type text, p_report_period_start date, p_report_period_end date, p_taken_with_food boolean, p_notes text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_dosing_log_audited(p_distribution_protocol_id uuid, p_product_id uuid, p_study_registration_id uuid, p_dose_amount text, p_dose_unit text, p_dose_count integer, p_dose_timing text[], p_is_custom_distribution boolean, p_report_type text, p_report_period_start date, p_report_period_end date, p_taken_with_food boolean, p_notes text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_dosing_log_audited(p_distribution_protocol_id uuid, p_product_id uuid, p_study_registration_id uuid, p_dose_amount text, p_dose_unit text, p_dose_count integer, p_dose_timing text[], p_is_custom_distribution boolean, p_report_type text, p_report_period_start date, p_report_period_end date, p_taken_with_food boolean, p_notes text) TO authenticated;
