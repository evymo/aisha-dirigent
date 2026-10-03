-- Function: public.revoke_user_role_admin
-- Arguments: p_role_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:03+01:00

CREATE OR REPLACE FUNCTION public.revoke_user_role_admin(p_role_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  DELETE FROM user_roles WHERE id = p_role_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Role not found: %', p_role_id;
  END IF;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_role_id::text,
      p_entity_type := 'user_role',
      p_new_values := jsonb_build_object('role_id', p_role_id),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated user role',
      p_tags := ARRAY['admin', 'user_role', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.revoke_user_role_admin(p_role_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_user_role_admin(p_role_id uuid) TO authenticated;
