-- Function: public.get_user_roles_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:47+01:00

CREATE OR REPLACE FUNCTION public.get_user_roles_admin()
 RETURNS TABLE(granted_at timestamptz, granted_by uuid, id uuid, profile_display_name text, profile_email text, role text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'user_roles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing user roles',
      p_tags := ARRAY['phi','admin','roles'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    ur.granted_at,
    ur.granted_by,
    ur.id,
    COALESCE(NULLIF(TRIM(p.display_name), ''), au.raw_user_meta_data->>'display_name', SPLIT_PART(au.email, '@', 1), 'Unknown') AS profile_display_name,
    COALESCE(p.email, au.email, '') AS profile_email,
    ur.role::text AS role,
    ur.user_id
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON ur.user_id = p.user_id
  LEFT JOIN aisha_auth.users au ON ur.user_id = au.id
  ORDER BY ur.granted_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_user_roles_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_roles_admin() TO authenticated;
