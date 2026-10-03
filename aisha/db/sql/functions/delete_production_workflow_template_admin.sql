-- Function: public.delete_production_workflow_template_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:25+01:00

CREATE OR REPLACE FUNCTION public.delete_production_workflow_template_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  DELETE FROM production_workflow_templates WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := p_id::text,
      p_entity_type := 'production_workflow_template',
      p_severity := 'info'::journal_severity,
      p_summary := 'Deleted production workflow template',
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_production_workflow_template_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_production_workflow_template_admin(p_id uuid) TO authenticated;
