-- Function: public.get_production_milestones_admin
-- Arguments: p_batch_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:22+01:00

CREATE OR REPLACE FUNCTION public.get_production_milestones_admin(p_batch_id uuid)
 RETURNS TABLE(id uuid, batch_id uuid, milestone_code text, name text, description text, achieved_at timestamptz, blockchain_tx_hash text, created_at timestamptz)
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
      p_entity_type := 'production_milestones',
      p_severity := 'info'::journal_severity,
      p_summary := 'Viewed production milestones',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pm.id,
    pm.batch_id,
    pm.milestone_code,
    pm.name,
    pm.description,
    pm.achieved_at,
    pm.blockchain_tx_hash,
    pm.created_at
  FROM production_milestones pm
  WHERE pm.batch_id = p_batch_id
  ORDER BY pm.achieved_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_milestones_admin(p_batch_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_milestones_admin(p_batch_id uuid) TO authenticated;
