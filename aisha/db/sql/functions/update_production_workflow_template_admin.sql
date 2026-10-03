-- Function: public.update_production_workflow_template_admin
-- Arguments: p_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:24+01:00

CREATE OR REPLACE FUNCTION public.update_production_workflow_template_admin(p_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE production_workflow_templates
  SET
    workflow_data = p_workflow_data,
    workflow_steps = p_workflow_steps
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := p_id::text,
      p_entity_type := 'production_workflow_template',
      p_severity := 'info'::journal_severity,
      p_summary := 'Updated production workflow template',
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_production_workflow_template_admin(p_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_production_workflow_template_admin(p_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb) TO authenticated;
