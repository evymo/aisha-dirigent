-- Function: public.get_production_workflow_steps_admin
-- Arguments: p_batch_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:23+01:00

CREATE OR REPLACE FUNCTION public.get_production_workflow_steps_admin(p_batch_id uuid)
 RETURNS TABLE(id uuid, batch_id uuid, step_name text, step_code text, step_order integer, status text, description text, started_at timestamptz, completed_at timestamptz, completed_by uuid, notes text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := p_batch_id::text,
      p_entity_type := 'production_workflow_steps',
      p_severity := 'info'::journal_severity,
      p_summary := 'Viewed production workflow steps',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pws.id,
    pws.batch_id,
    pws.step_name,
    pws.step_code,
    pws.step_order,
    pws.status::text,
    pws.description,
    pws.started_at,
    pws.completed_at,
    pws.completed_by,
    pws.notes,
    pws.created_at,
    pws.updated_at
  FROM production_workflow_steps pws
  WHERE pws.batch_id = p_batch_id
  ORDER BY pws.step_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_workflow_steps_admin(p_batch_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_workflow_steps_admin(p_batch_id uuid) TO authenticated;
