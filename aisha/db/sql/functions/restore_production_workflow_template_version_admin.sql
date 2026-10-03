-- Function: public.restore_production_workflow_template_version_admin
-- Arguments: p_template_id uuid, p_version_number integer
-- Description: Restore template to a specific version. Creates a new version from old data (non-destructive).
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.restore_production_workflow_template_version_admin(
  p_template_id uuid DEFAULT NULL,
  p_version_number integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_data jsonb;
  v_steps jsonb;
  v_next_version integer;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Get version data
  SELECT v.workflow_data, v.workflow_steps INTO v_data, v_steps
  FROM production_workflow_template_versions v
  WHERE v.template_id = p_template_id AND v.version_number = p_version_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version % not found for template %', p_version_number, p_template_id;
  END IF;

  -- Create a new version (restore is not overwrite — it's a new version from old data)
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM production_workflow_template_versions
  WHERE template_id = p_template_id;

  INSERT INTO production_workflow_template_versions (
    template_id, version_number, version_label,
    workflow_data, workflow_steps,
    change_summary, created_by
  ) VALUES (
    p_template_id, v_next_version,
    'v' || v_next_version || ' (restored from v' || p_version_number || ')',
    v_data, v_steps,
    format('Restored from version %s', p_version_number),
    auth.uid()
  );

  UPDATE production_workflow_templates
  SET
    workflow_data = v_data,
    workflow_steps = v_steps,
    current_version_number = v_next_version,
    updated_at = now()
  WHERE id = p_template_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'production'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_template_id::text,
    p_entity_type := 'production_workflow_template',
    p_new_values := jsonb_build_object(
      'restored_from_version', p_version_number,
      'new_version', v_next_version
    ),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := format('Template restored from version %s to v%s', p_version_number, v_next_version),
    p_tags := ARRAY['admin', 'workflow_template', 'version_restore'],
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_production_workflow_template_version_admin(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_production_workflow_template_version_admin(uuid, integer) TO authenticated;
