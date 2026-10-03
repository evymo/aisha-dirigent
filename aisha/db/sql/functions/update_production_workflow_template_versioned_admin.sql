-- Function: public.update_production_workflow_template_versioned_admin
-- Arguments: p_change_summary text, p_id uuid, p_version_label text, p_workflow_data jsonb, p_workflow_steps jsonb
-- Description: Save workflow template with automatic versioning. Creates a version snapshot before updating.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.update_production_workflow_template_versioned_admin(
  p_change_summary text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_version_label text DEFAULT NULL,
  p_workflow_data jsonb DEFAULT NULL,
  p_workflow_steps jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next_version integer;
  v_version_id uuid;
  v_old_data jsonb;
  v_old_steps jsonb;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Get current data for audit
  SELECT workflow_data, workflow_steps INTO v_old_data, v_old_steps
  FROM production_workflow_templates
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found: %', p_id;
  END IF;

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM production_workflow_template_versions
  WHERE template_id = p_id;

  -- Snapshot current state as new version
  INSERT INTO production_workflow_template_versions (
    template_id, version_number, version_label,
    workflow_data, workflow_steps,
    change_summary, created_by
  ) VALUES (
    p_id, v_next_version, COALESCE(p_version_label, 'v' || v_next_version),
    p_workflow_data, p_workflow_steps,
    p_change_summary, auth.uid()
  )
  RETURNING id INTO v_version_id;

  -- Update main template
  UPDATE production_workflow_templates
  SET
    workflow_data = p_workflow_data,
    workflow_steps = p_workflow_steps,
    current_version_number = v_next_version,
    updated_at = now()
  WHERE id = p_id;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'production'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_id::text,
    p_entity_type := 'production_workflow_template',
    p_new_values := jsonb_build_object(
      'version_number', v_next_version,
      'version_label', COALESCE(p_version_label, 'v' || v_next_version),
      'change_summary', p_change_summary
    ),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := format('Template versioned: v%s → v%s', v_next_version - 1, v_next_version),
    p_tags := ARRAY['admin', 'workflow_template', 'versioning'],
    p_user_id := auth.uid()
  );

  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'version_number', v_next_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_production_workflow_template_versioned_admin(text, uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_production_workflow_template_versioned_admin(text, uuid, text, jsonb, jsonb) TO authenticated;
