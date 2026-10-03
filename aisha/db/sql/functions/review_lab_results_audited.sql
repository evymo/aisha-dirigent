-- Function: public.review_lab_results_audited
-- Arguments: p_lab_result_id uuid, p_status lab_result_status, p_notes text, p_results jsonb
-- Description: Reviews or updates lab results with permissions. Audited.

CREATE OR REPLACE FUNCTION public.review_lab_results_audited(
  p_lab_result_id uuid,
  p_status lab_result_status DEFAULT 'reviewed'::lab_result_status,
  p_notes text DEFAULT NULL::text,
  p_results jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_is_admin boolean;
  v_lab record;
  v_status lab_result_status;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT l.id, l.user_id, l.document_id
  INTO v_lab
  FROM public.lab_results l
  WHERE l.id = p_lab_result_id;

  IF v_lab.id IS NULL THEN
    RAISE EXCEPTION 'Lab result not found';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);
  SELECT pp.id INTO v_partner_id FROM public.partner_profiles pp WHERE pp.user_id = v_user_id;

  IF NOT (
    v_is_admin
    OR (
      v_partner_id IS NOT NULL
      AND public.has_data_sharing_consent(v_lab.user_id, v_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.document_sharing_permissions dsp
        WHERE dsp.document_id = v_lab.document_id
          AND dsp.revoked_at IS NULL
          AND dsp.can_view = true
          AND (
            dsp.shared_with_partner_id = v_partner_id
            OR (dsp.shared_with_study_id IS NOT NULL AND public.is_study_consultant(dsp.shared_with_study_id))
          )
      )
    )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_status := COALESCE(p_status, 'reviewed'::lab_result_status);
  IF v_status NOT IN ('pending', 'completed', 'reviewed') THEN
    v_status := 'reviewed'::lab_result_status;
  END IF;

  UPDATE public.lab_results
  SET
    status = v_status,
    reviewed_by = CASE WHEN v_status = 'reviewed' THEN v_user_id ELSE reviewed_by END,
    reviewed_at = CASE WHEN v_status = 'reviewed' THEN now() ELSE reviewed_at END,
    notes = COALESCE(p_notes, notes),
    crp = COALESCE(NULLIF(replace(regexp_replace(p_results->>'crp', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, crp),
    esr = COALESCE(NULLIF(replace(regexp_replace(p_results->>'esr', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, esr),
    wbc = COALESCE(NULLIF(replace(regexp_replace(p_results->>'wbc', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, wbc),
    rbc = COALESCE(NULLIF(replace(regexp_replace(p_results->>'rbc', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, rbc),
    hemoglobin = COALESCE(NULLIF(replace(regexp_replace(p_results->>'hemoglobin', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, hemoglobin),
    platelets = COALESCE(NULLIF(replace(regexp_replace(p_results->>'platelets', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, platelets),
    glucose = COALESCE(NULLIF(replace(regexp_replace(p_results->>'glucose', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, glucose),
    hba1c = COALESCE(NULLIF(replace(regexp_replace(p_results->>'hba1c', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, hba1c),
    insulin = COALESCE(NULLIF(replace(regexp_replace(p_results->>'insulin', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, insulin),
    cholesterol_total = COALESCE(NULLIF(replace(regexp_replace(p_results->>'cholesterol_total', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, cholesterol_total),
    ldl = COALESCE(NULLIF(replace(regexp_replace(p_results->>'ldl', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, ldl),
    hdl = COALESCE(NULLIF(replace(regexp_replace(p_results->>'hdl', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, hdl),
    triglycerides = COALESCE(NULLIF(replace(regexp_replace(p_results->>'triglycerides', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, triglycerides),
    alt = COALESCE(NULLIF(replace(regexp_replace(p_results->>'alt', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, alt),
    ast = COALESCE(NULLIF(replace(regexp_replace(p_results->>'ast', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, ast),
    creatinine = COALESCE(NULLIF(replace(regexp_replace(p_results->>'creatinine', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, creatinine),
    urea = COALESCE(NULLIF(replace(regexp_replace(p_results->>'urea', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, urea),
    vitamin_d = COALESCE(NULLIF(replace(regexp_replace(p_results->>'vitamin_d', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, vitamin_d),
    vitamin_b12 = COALESCE(NULLIF(replace(regexp_replace(p_results->>'vitamin_b12', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, vitamin_b12),
    nk_cells = COALESCE(NULLIF(replace(regexp_replace(p_results->>'nk_cells', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, nk_cells),
    cd4_count = COALESCE(NULLIF(replace(regexp_replace(p_results->>'cd4_count', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, cd4_count),
    cd8_count = COALESCE(NULLIF(replace(regexp_replace(p_results->>'cd8_count', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, cd8_count),
    il_4 = COALESCE(NULLIF(replace(regexp_replace(p_results->>'il_4', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, il_4),
    il_6 = COALESCE(NULLIF(replace(regexp_replace(p_results->>'il_6', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, il_6),
    tnf_alpha = COALESCE(NULLIF(replace(regexp_replace(p_results->>'tnf_alpha', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, tnf_alpha),
    nad_nadh_ratio = COALESCE(NULLIF(replace(regexp_replace(p_results->>'nad_nadh_ratio', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, nad_nadh_ratio),
    omega3_index = COALESCE(NULLIF(replace(regexp_replace(p_results->>'omega3_index', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, omega3_index),
    raw_data = CASE WHEN p_results IS NULL THEN raw_data ELSE jsonb_set(COALESCE(raw_data, '{}'::jsonb), '{reviewed_values}', p_results, true) END,
    updated_at = now()
  WHERE id = p_lab_result_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'documents',
      p_details := jsonb_build_object('status', v_status::text),
      p_entity_id := p_lab_result_id::text,
      p_entity_type := 'lab_result',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Lab result reviewed',
      p_tags := ARRAY['phi','documents','lab_results','review'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.review_lab_results_audited(uuid, lab_result_status, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_lab_results_audited(uuid, lab_result_status, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_lab_results_audited(uuid, lab_result_status, text, jsonb) TO authenticated;
