-- Function: public.get_production_workflow_template_versions_admin
-- Arguments: p_template_id uuid
-- Description: Get version history for a workflow template.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.get_production_workflow_template_versions_admin(
  p_template_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  template_id uuid,
  version_number integer,
  version_label text,
  workflow_data jsonb,
  workflow_steps jsonb,
  change_summary text,
  created_by uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    v.id, v.template_id, v.version_number, v.version_label,
    v.workflow_data, v.workflow_steps, v.change_summary,
    v.created_by, v.created_at
  FROM production_workflow_template_versions v
  WHERE v.template_id = p_template_id
  ORDER BY v.version_number DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_production_workflow_template_versions_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_workflow_template_versions_admin(uuid) TO authenticated;
