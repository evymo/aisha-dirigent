-- Function: public.grant_app_role_permission_admin
-- Arguments: p_role text, p_permission_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:48+01:00

CREATE OR REPLACE FUNCTION public.grant_app_role_permission_admin(p_role text, p_permission_code text)
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

  -- Insert if not exists into app_role_permissions (correct table)
  INSERT INTO public.app_role_permissions (role, permission_id, granted_by)
  VALUES (p_role::app_role, v_permission_id, auth.uid())
  ON CONFLICT (role, permission_id) DO NOTHING;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('role', p_role, 'permission_code', p_permission_code),
      p_entity_id := NULL,
      p_entity_type := 'app_role_permission',
      p_severity := 'info'::journal_severity,
      p_summary := format('Granted permission %s to role %s', p_permission_code, p_role),
    p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_app_role_permission_admin(p_role text, p_permission_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_app_role_permission_admin(p_role text, p_permission_code text) TO authenticated;
