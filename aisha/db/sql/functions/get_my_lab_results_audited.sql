-- Function: public.get_my_lab_results_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:58+01:00

CREATE OR REPLACE FUNCTION public.get_my_lab_results_audited(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, user_id uuid, study_registration_id uuid, document_id uuid, test_date date, result_date date, lab_name text, status lab_result_status, crp numeric, esr numeric, wbc numeric, rbc numeric, hemoglobin numeric, platelets numeric, glucose numeric, hba1c numeric, insulin numeric, cholesterol_total numeric, ldl numeric, hdl numeric, triglycerides numeric, alt numeric, ast numeric, creatinine numeric, urea numeric, vitamin_d numeric, vitamin_b12 numeric, nk_cells numeric, cd4_count numeric, cd8_count numeric, il_4 numeric, il_6 numeric, tnf_alpha numeric, nad_nadh_ratio numeric, omega3_index numeric, results jsonb, raw_data jsonb, file_url text, notes text, reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'studies',
      p_details := jsonb_build_object('result', 'granted', 'limit', GREATEST(0, COALESCE(p_limit, 0))),
      p_entity_id := NULL,
      p_entity_type := 'lab_result',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewed lab results',
      p_tags := ARRAY['phi','member','lab_results'],
      p_user_id := v_uid
  );

  RETURN QUERY
    SELECT
      l.id,
      l.user_id,
      l.study_registration_id,
      l.document_id,
      l.test_date,
      l.result_date,
      l.lab_name,
      l.status,
      l.crp,
      l.esr,
      l.wbc,
      l.rbc,
      l.hemoglobin,
      l.platelets,
      l.glucose,
      l.hba1c,
      l.insulin,
      l.cholesterol_total,
      l.ldl,
      l.hdl,
      l.triglycerides,
      l.alt,
      l.ast,
      l.creatinine,
      l.urea,
      l.vitamin_d,
      l.vitamin_b12,
      l.nk_cells,
      l.cd4_count,
      l.cd8_count,
      l.il_4,
      l.il_6,
      l.tnf_alpha,
      l.nad_nadh_ratio,
      l.omega3_index,
      l.results,
      l.raw_data,
      l.file_url,
      l.notes,
      l.reviewed_by,
      l.reviewed_at,
      l.created_at,
      l.updated_at
    FROM public.lab_results l
    WHERE l.user_id = v_uid
    ORDER BY l.test_date DESC
    LIMIT GREATEST(0, COALESCE(p_limit, 0));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_lab_results_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_lab_results_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_lab_results_audited(p_limit integer) TO authenticated;
