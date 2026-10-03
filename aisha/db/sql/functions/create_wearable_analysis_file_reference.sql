-- Function: create_wearable_analysis_file_reference
-- Purpose: Store reference to wearable analysis output file for current user
-- Access: authenticated
-- Security: SECURITY DEFINER with ownership checks

CREATE OR REPLACE FUNCTION public.create_wearable_analysis_file_reference(
  p_sync_batch_id uuid,
  p_file_path text,
  p_file_name text,
  p_data_source text DEFAULT 'wearable',
  p_analysis_kind text DEFAULT 'daily_summary',
  p_file_bucket text DEFAULT 'wearable-analysis',
  p_checksum_sha256 text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_file_id uuid;
  v_is_new boolean := false;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF v_user_id IS NULL THEN
    IF v_role = 'service_role' AND p_user_id IS NOT NULL THEN
      v_user_id := p_user_id;
    ELSE
      RAISE EXCEPTION 'Not authenticated';
    END IF;
  END IF;

  IF p_sync_batch_id IS NULL THEN
    RAISE EXCEPTION 'sync_batch_id is required';
  END IF;

  IF p_file_path IS NULL OR btrim(p_file_path) = '' THEN
    RAISE EXCEPTION 'file_path is required';
  END IF;

  IF p_file_name IS NULL OR btrim(p_file_name) = '' THEN
    RAISE EXCEPTION 'file_name is required';
  END IF;

  -- Ensure the referenced sync batch belongs to the current user.
  IF NOT EXISTS (
    SELECT 1
    FROM public.health_data_sync_log hsl
    WHERE hsl.sync_batch_id = p_sync_batch_id
      AND hsl.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Sync batch not found for current user';
  END IF;

  INSERT INTO public.wearable_analysis_files (
    user_id,
    sync_batch_id,
    data_source,
    analysis_kind,
    file_bucket,
    file_path,
    file_name,
    checksum_sha256,
    metadata
  )
  VALUES (
    v_user_id,
    p_sync_batch_id,
    COALESCE(NULLIF(btrim(p_data_source), ''), 'wearable'),
    COALESCE(NULLIF(btrim(p_analysis_kind), ''), 'daily_summary'),
    COALESCE(NULLIF(btrim(p_file_bucket), ''), 'wearable-analysis'),
    p_file_path,
    p_file_name,
    p_checksum_sha256,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (sync_batch_id, file_path)
  DO UPDATE SET
    file_name = EXCLUDED.file_name,
    checksum_sha256 = COALESCE(EXCLUDED.checksum_sha256, wearable_analysis_files.checksum_sha256),
    metadata = wearable_analysis_files.metadata || EXCLUDED.metadata
  RETURNING id, (xmax = 0) INTO v_file_id, v_is_new;

  -- Audit without sensitive data payload.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    CASE
      WHEN v_is_new THEN 'WEARABLE_ANALYSIS_REFERENCE_CREATED'
      ELSE 'WEARABLE_ANALYSIS_REFERENCE_UPDATED'
    END,
    jsonb_build_object(
      'area', 'wearable',
      'severity', 'info',
      'entity_type', 'wearable_analysis_file',
      'entity_id', v_file_id,
      'sync_batch_id', p_sync_batch_id,
      'analysis_kind', COALESCE(NULLIF(btrim(p_analysis_kind), ''), 'daily_summary')
    )
  );


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'health'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_sync_batch_id::text,
      p_entity_type := 'wearable_analysis_file_reference',
      p_new_values := jsonb_build_object('sync_batch_id', p_sync_batch_id, 'file_path', p_file_path, 'data_source', p_data_source, 'analysis_kind', p_analysis_kind, 'file_bucket', p_file_bucket),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin created wearable analysis file reference',
      p_tags := ARRAY['admin', 'wearable_analysis_file_reference', 'create'],
      p_user_id := auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'file_id', v_file_id,
    'sync_batch_id', p_sync_batch_id,
    'is_new', v_is_new
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_wearable_analysis_file_reference(uuid, text, text, text, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_wearable_analysis_file_reference(uuid, text, text, text, text, text, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_wearable_analysis_file_reference(uuid, text, text, text, text, text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_wearable_analysis_file_reference(uuid, text, text, text, text, text, text, jsonb, uuid) TO service_role;

COMMENT ON FUNCTION public.create_wearable_analysis_file_reference(uuid, text, text, text, text, text, text, jsonb, uuid) IS
  'Creates or updates a wearable analysis output file reference for the current user sync batch.';
