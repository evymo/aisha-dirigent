-- Function: public.create_health_document_preflight_audited
-- Arguments: p_file_name text, p_file_path text, p_file_size integer, p_mime_type text, p_category health_document_category,
--            p_title text, p_description text, p_document_date date, p_study_registration_id uuid
-- Description: Creates a member_health_documents row for an upload preflight (owner only). Audited.

CREATE OR REPLACE FUNCTION public.create_health_document_preflight_audited(
  p_file_name text,
  p_file_path text,
  p_file_size integer,
  p_mime_type text,
  p_category health_document_category,
  p_title text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_document_date date DEFAULT NULL::date,
  p_study_registration_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid,
  file_path text,
  file_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_registration_user_id uuid;
  v_doc_id uuid;
  v_doc_path text;
  v_doc_name text;
  v_quarantine_on boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Parametric activation of the upload AV/quarantine flow. While OFF (default — key absent
  -- ⇒ '{}' ≠ 'true'), a new document starts 'clear' (servable immediately, exactly the
  -- pre-feature behaviour — no regression). It is flipped ON only once the full coherent flow
  -- is in place (quarantine-bucket routing + clamd scan→promote worker + serving gates), so
  -- 'flagged' is never set without a promoter to clear it. Doubles as an ops kill-switch.
  v_quarantine_on := public.get_system_config('av.upload_quarantine_enabled') = 'true'::jsonb;

  IF p_file_path IS NULL OR p_file_path NOT LIKE v_user_id::text || '/%' THEN
    RAISE EXCEPTION 'Invalid file path' USING ERRCODE = '22023';
  END IF;

  IF p_study_registration_id IS NOT NULL THEN
    SELECT se.user_id
    INTO v_registration_user_id
    FROM public.study_registrations se
    WHERE se.id = p_study_registration_id;

    IF v_registration_user_id IS NULL OR v_registration_user_id <> v_user_id THEN
      RAISE EXCEPTION 'Invalid study registration' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.member_health_documents (
    user_id,
    file_name,
    file_path,
    file_size,
    mime_type,
    category,
    title,
    description,
    document_date,
    study_registration_id,
    quarantine_status
  ) VALUES (
    v_user_id,
    p_file_name,
    p_file_path,
    p_file_size,
    p_mime_type,
    COALESCE(p_category, 'other'::health_document_category),
    p_title,
    p_description,
    p_document_date,
    p_study_registration_id,
    -- Flag-gated: when the upload AV/quarantine flow is ON, a new upload starts 'flagged'
    -- (fail-closed — blocked until record_document_av_scan_audited promotes it to 'clear').
    -- When OFF (default) it starts 'clear', matching the pre-feature behaviour so there is
    -- never a 'flagged' row without a scan→promote worker to clear it.
    CASE WHEN v_quarantine_on THEN 'flagged' ELSE 'clear' END
  )
  RETURNING member_health_documents.id, member_health_documents.file_path, member_health_documents.file_name
  INTO v_doc_id, v_doc_path, v_doc_name;

  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := 'documents',
      p_details := jsonb_build_object(
      'category', COALESCE(p_category::text, 'other'),
      'file_size', COALESCE(p_file_size, 0),
      'has_study_registration', p_study_registration_id IS NOT NULL
    ),
      p_entity_id := v_doc_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document upload preflight created',
      p_tags := ARRAY['phi','documents','upload'],
      p_user_id := v_user_id
  );

  RETURN QUERY SELECT v_doc_id, v_doc_path, v_doc_name;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_health_document_preflight_audited(text, text, integer, text, health_document_category, text, text, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_health_document_preflight_audited(text, text, integer, text, health_document_category, text, text, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_health_document_preflight_audited(text, text, integer, text, health_document_category, text, text, date, uuid) TO authenticated;
