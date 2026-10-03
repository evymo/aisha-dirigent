-- Function: public.revoke_app_role_permission_admin
-- Arguments: p_role text, p_permission_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:01+01:00

CREATE OR REPLACE FUNCTION public.revoke_app_role_permission_admin(p_role text, p_permission_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_permission_id UUID;
BEGIN
  -- Only admins can call this
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required';
  END IF;

  -- Get permission ID
  SELECT id INTO v_permission_id
  FROM public.permissions
  WHERE code = p_permission_code;

  IF v_permission_id IS NULL THEN
    RAISE EXCEPTION 'Permission not found: %', p_permission_code;
  END IF;

  -- Delete the mapping from app_role_permissions (correct table)
  DELETE FROM public.app_role_permissions
  WHERE role = p_role::app_role AND permission_id = v_permission_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('role', p_role, 'permission_code', p_permission_code),
      p_entity_id := NULL,
      p_entity_type := 'app_role_permission',
      p_severity := 'info'::journal_severity,
      p_summary := format('Revoked permission %s from role %s', p_permission_code, p_role),
    p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.revoke_app_role_permission_admin(p_role text, p_permission_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_app_role_permission_admin(p_role text, p_permission_code text) TO authenticated;
