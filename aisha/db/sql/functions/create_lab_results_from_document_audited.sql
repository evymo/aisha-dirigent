-- Function: public.create_lab_results_from_document_audited
-- Arguments: p_document_id uuid, p_test_date date, p_lab_name text, p_results jsonb, p_notes text, p_status lab_result_status
-- Description: Creates lab_results from reviewed document data. Audited.

CREATE OR REPLACE FUNCTION public.create_lab_results_from_document_audited(
  p_document_id uuid,
  p_test_date date DEFAULT NULL::date,
  p_lab_name text DEFAULT NULL::text,
  p_results jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL::text,
  p_status lab_result_status DEFAULT 'pending'::lab_result_status
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
  v_doc record;
  v_status lab_result_status;
  v_test_date date;
  v_lab_name text;
  v_lab_result_id uuid;
  v_reviewed_by uuid;
  v_reviewed_at timestamptz;
  v_value text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, study_registration_id, document_date, category
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  IF v_doc.category <> 'lab_results' THEN
    RAISE EXCEPTION 'Document category is not lab_results';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);
  SELECT pp.id INTO v_partner_id FROM public.partner_profiles pp WHERE pp.user_id = v_user_id;

  IF NOT (
    v_is_admin
    OR (
      v_partner_id IS NOT NULL
      AND public.has_data_sharing_consent(v_doc.user_id, v_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.document_sharing_permissions dsp
        WHERE dsp.document_id = v_doc.id
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

  v_status := COALESCE(p_status, 'pending'::lab_result_status);
  IF v_status NOT IN ('pending', 'completed', 'reviewed') THEN
    v_status := 'pending'::lab_result_status;
  END IF;

  IF v_status = 'reviewed' THEN
    v_reviewed_by := v_user_id;
    v_reviewed_at := now();
  END IF;

  v_test_date := COALESCE(p_test_date, v_doc.document_date);
  IF v_test_date IS NULL THEN
    BEGIN
      v_test_date := NULLIF(p_results->>'test_date', '')::date;
    EXCEPTION WHEN others THEN
      v_test_date := NULL;
    END;
  END IF;

  v_lab_name := COALESCE(NULLIF(p_lab_name, ''), NULLIF(p_results->>'lab_name', ''), NULLIF(p_results->>'laboratory', ''), NULLIF(p_results->>'lab', ''), 'Unknown');

  INSERT INTO public.lab_results (
    user_id,
    study_registration_id,
    document_id,
    test_date,
    lab_name,
    status,
    crp,
    esr,
    wbc,
    rbc,
    hemoglobin,
    platelets,
    glucose,
    hba1c,
    insulin,
    cholesterol_total,
    ldl,
    hdl,
    triglycerides,
    alt,
    ast,
    creatinine,
    urea,
    vitamin_d,
    vitamin_b12,
    nk_cells,
    cd4_count,
    cd8_count,
    il_4,
    il_6,
    tnf_alpha,
    nad_nadh_ratio,
    omega3_index,
    results,
    raw_data,
    notes,
    reviewed_by,
    reviewed_at
  ) VALUES (
    v_doc.user_id,
    v_doc.study_registration_id,
    v_doc.id,
    COALESCE(v_test_date, CURRENT_DATE),
    v_lab_name,
    v_status,
    NULLIF(replace(regexp_replace(p_results->>'crp', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'esr', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'wbc', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'rbc', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'hemoglobin', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'platelets', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'glucose', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'hba1c', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'insulin', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'cholesterol_total', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'ldl', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'hdl', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'triglycerides', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'alt', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'ast', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'creatinine', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'urea', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'vitamin_d', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'vitamin_b12', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'nk_cells', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'cd4_count', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'cd8_count', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'il_4', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'il_6', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'tnf_alpha', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'nad_nadh_ratio', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    NULLIF(replace(regexp_replace(p_results->>'omega3_index', '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric,
    p_results,
    jsonb_build_object(
      'source', 'health_document',
      'document_id', p_document_id,
      'extracted_data', p_results
    ),
    p_notes,
    v_reviewed_by,
    v_reviewed_at
  )
  RETURNING id INTO v_lab_result_id;

  UPDATE public.member_health_documents
  SET
    verified_at = COALESCE(verified_at, now()),
    verified_by = COALESCE(verified_by, v_user_id),
    review_notes = COALESCE(p_notes, review_notes),
    updated_at = now()
  WHERE id = p_document_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := 'documents',
      p_details := jsonb_build_object(
      'document_id', p_document_id,
      'status', v_status::text
    ),
      p_entity_id := v_lab_result_id::text,
      p_entity_type := 'lab_result',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Lab results created from document',
      p_tags := ARRAY['phi','documents','lab_results'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object('lab_result_id', v_lab_result_id);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_lab_results_from_document_audited(uuid, date, text, jsonb, text, lab_result_status) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_lab_results_from_document_audited(uuid, date, text, jsonb, text, lab_result_status) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_lab_results_from_document_audited(uuid, date, text, jsonb, text, lab_result_status) TO authenticated;
