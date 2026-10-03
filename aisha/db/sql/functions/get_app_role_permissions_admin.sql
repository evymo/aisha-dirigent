-- Function: public.get_app_role_permissions_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:35+01:00

CREATE OR REPLACE FUNCTION public.get_app_role_permissions_admin()
 RETURNS TABLE(granted_at timestamptz, granted_by uuid, id uuid, permission_code text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'role_permission',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read role permission',
      p_tags := ARRAY['admin', 'role_permission'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    arp.granted_at,
    arp.granted_by,
    arp.id,
    p.code AS permission_code,
    arp.role::text AS role
  FROM public.app_role_permissions arp
  JOIN public.permissions p ON arp.permission_id = p.id
  ORDER BY arp.role, p.code;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_app_role_permissions_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_role_permissions_admin() TO authenticated;
