-- Function: public.get_user_lab_results_audited
-- Arguments: p_user_id uuid, p_limit integer DEFAULT 30
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_user_lab_results_audited(p_user_id uuid, p_limit integer DEFAULT 30)
 RETURNS SETOF lab_results
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean;
  v_has_consent boolean;
  v_is_consultant boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_caller_id);
  v_is_consultant := public.is_consultant_for_user(p_user_id);
  v_has_consent := public.has_data_sharing_consent(p_user_id, v_caller_id);

  IF NOT v_is_admin AND NOT (v_is_consultant AND v_has_consent) THEN
     RAISE EXCEPTION 'Access denied: No valid relationship or consent found for this user.';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'operational_data',
      p_details := jsonb_build_object(
      'user_id', p_user_id,
      'limit', p_limit,
      'access_type', CASE WHEN v_is_admin THEN 'admin' ELSE 'consultant' END
    ),
      p_entity_id := NULL,
      p_entity_type := 'lab_result',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Professional viewed user lab results',
      p_tags := ARRAY['phi', 'user_data', 'lab_results'],
      p_user_id := v_caller_id
  );

  RETURN QUERY
    SELECT
      l.id,
      l.user_id,
      l.test_type,
      l.test_date,
      l.result_date,
      l.results,
      l.file_url,
      l.notes,
      l.created_at,
      l.study_registration_id,
      l.document_id,
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
      l.raw_data,
      l.reviewed_by,
      l.reviewed_at,
      l.updated_at
    FROM public.lab_results l
    WHERE l.user_id = p_user_id
    ORDER BY l.test_date DESC
    LIMIT GREATEST(0, COALESCE(p_limit, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_lab_results_audited(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_lab_results_audited(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_lab_results_audited(uuid, integer) TO service_role;
