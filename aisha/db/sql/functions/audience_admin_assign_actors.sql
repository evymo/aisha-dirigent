-- Function: audience_admin_assign_actors

CREATE OR REPLACE FUNCTION public.audience_admin_assign_actors(p_actor_ids uuid[], p_assigned_to_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Use study_consultants as universal scoped role binding (scope_type='actor')
  INSERT INTO public.study_consultants (study_id, partner_id, role, status, scope_type, approved_at, approved_by)
  SELECT actor_id, p_assigned_to_user_id, 'account_manager', 'approved', 'actor', now(), auth.uid()
  FROM unnest(p_actor_ids) actor_id
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.audience_log_event(
    'bulk_assign',
    'audience_admin_assign_actors',
    'role_assignment',
    NULL,
    format('Assigned %s actors to user %s', v_inserted, p_assigned_to_user_id),
    jsonb_build_object('assigned_to', p_assigned_to_user_id, 'actor_ids', p_actor_ids, 'inserted', v_inserted)
  );

  RETURN v_inserted;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_assign_actors(uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_assign_actors(uuid[],uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_assign_actors(uuid[],uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_assign_actors(uuid[],uuid) TO service_role;
