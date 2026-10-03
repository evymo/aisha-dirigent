-- Source of truth: get_lab_result_detail_audited
-- See migration: 20260220130100_add_lab_result_detail_audited.sql

CREATE OR REPLACE FUNCTION public.get_lab_result_detail_audited(
  p_lab_result_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid;
  v_result_user_id uuid;
  v_partner_id uuid;
  v_has_access boolean := false;
  v_result jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get the owner of the lab result
  SELECT lr.user_id INTO v_result_user_id
  FROM lab_results lr
  WHERE lr.id = p_lab_result_id;

  IF v_result_user_id IS NULL THEN
    RAISE EXCEPTION 'Lab result not found';
  END IF;

  -- Self-access
  IF v_actor_id = v_result_user_id THEN
    v_has_access := true;
  END IF;

  -- Partner/consultant access with data sharing consent check
  IF NOT v_has_access THEN
    SELECT pp.id INTO v_partner_id
    FROM partner_profiles pp
    WHERE pp.user_id = v_actor_id;

    IF v_partner_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM study_registrations se
        JOIN study_consultants sc ON sc.id = se.consultant_id
        WHERE se.user_id = v_result_user_id
          AND sc.partner_id = v_partner_id
          AND sc.status = 'approved'
      ) AND public.has_data_sharing_consent(v_result_user_id, v_actor_id)
      INTO v_has_access;
    END IF;
  END IF;

  -- Admin/staff bypass
  IF NOT v_has_access AND public.is_admin_or_staff(v_actor_id) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Access denied to lab result data';
  END IF;

  -- Audit log (no sensitive data in metadata — only IDs)
  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := 'operational_data',
    p_details := jsonb_build_object(
      'lab_result_id', p_lab_result_id,
      'access_type', CASE
        WHEN v_actor_id = v_result_user_id THEN 'self'
        WHEN public.is_admin_or_staff(v_actor_id) THEN 'admin'
        ELSE 'consultant'
      END
    ),
    p_entity_id := p_lab_result_id::text,
    p_entity_type := 'lab_result',
    p_severity := 'notice',
    p_summary := 'Viewed lab result detail',
    p_tags := ARRAY['phi', 'lab_result', 'detail_view'],
    p_user_id := v_actor_id
  );

  -- Build lab result detail with reviewer name JOIN
  SELECT jsonb_build_object(
    'id', lr.id,
    'user_id', lr.user_id,
    'test_type', lr.test_type,
    'test_date', lr.test_date,
    'result_date', lr.result_date,
    'lab_name', lr.lab_name,
    'status', lr.status,
    'file_url', lr.file_url,
    'notes', lr.notes,
    'results', lr.results,
    'created_at', lr.created_at,
    'reviewed_at', lr.reviewed_at,
    'reviewed_by', lr.reviewed_by,
    'reviewer_display_name', p.display_name,
    'updated_at', lr.updated_at,
    -- Biomarkers: only include non-null values to keep payload small
    'biomarkers', jsonb_strip_nulls(jsonb_build_object(
      'crp', lr.crp,
      'esr', lr.esr,
      'wbc', lr.wbc,
      'rbc', lr.rbc,
      'hemoglobin', lr.hemoglobin,
      'platelets', lr.platelets,
      'glucose', lr.glucose,
      'hba1c', lr.hba1c,
      'insulin', lr.insulin,
      'cholesterol_total', lr.cholesterol_total,
      'ldl', lr.ldl,
      'hdl', lr.hdl,
      'triglycerides', lr.triglycerides,
      'alt', lr.alt,
      'ast', lr.ast,
      'creatinine', lr.creatinine,
      'urea', lr.urea,
      'vitamin_d', lr.vitamin_d,
      'vitamin_b12', lr.vitamin_b12,
      'nk_cells', lr.nk_cells,
      'cd4_count', lr.cd4_count,
      'cd8_count', lr.cd8_count,
      'il_4', lr.il_4,
      'il_6', lr.il_6,
      'tnf_alpha', lr.tnf_alpha,
      'nad_nadh_ratio', lr.nad_nadh_ratio,
      'omega3_index', lr.omega3_index
    ))
  ) INTO v_result
  FROM lab_results lr
  LEFT JOIN profiles p ON p.user_id = lr.reviewed_by
  WHERE lr.id = p_lab_result_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_lab_result_detail_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lab_result_detail_audited(uuid) TO authenticated;
