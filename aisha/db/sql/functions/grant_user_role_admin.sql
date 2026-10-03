-- Function: public.grant_user_role_admin
-- Arguments: p_email text, p_role text
-- Description: Grant a role to a user by email. Admin only.
-- Security: SECURITY DEFINER, admin only
-- Updated: 2026-01-09 - Changed from p_user_id to p_email for better UX

CREATE OR REPLACE FUNCTION public.grant_user_role_admin(p_email text, p_role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_role_id uuid;
  v_user_id uuid;
  v_role public.app_role;
BEGIN
  -- Only admin can grant roles
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only admin can grant roles';
  END IF;

  -- Look up user by email
  SELECT id INTO v_user_id
  FROM aisha_auth.users
  WHERE email = lower(p_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: User with email % not found', p_email;
  END IF;

  -- Cast text to app_role enum
  BEGIN
    v_role := p_role::public.app_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid role: %s', p_role), ERRCODE = '22023';
  END;

  -- Check if role already exists
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user_id AND ur.role = v_role
  ) THEN
    RAISE EXCEPTION 'User already has this role';
  END IF;

  -- Insert new role
  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (v_user_id, v_role, auth.uid())
  RETURNING id INTO v_user_role_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := 'admin',
      p_details := jsonb_build_object('role', p_role, 'target_user_id', v_user_id),
      p_entity_id := v_user_id::text,
      p_entity_type := 'user_roles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := format('Granted role %s to user', p_role),
      p_tags := ARRAY['admin', 'roles'],
      p_user_id := auth.uid()
  );

  RETURN v_user_role_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_user_role_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_user_role_admin(text, text) TO authenticated;
