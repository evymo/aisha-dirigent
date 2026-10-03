-- Function: public.revoke_permission_admin
-- Arguments: p_role text, p_section text, p_permission text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:03+01:00

CREATE OR REPLACE FUNCTION public.revoke_permission_admin(p_role text, p_section text, p_permission text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin required');
  END IF;
  
  DELETE FROM role_permissions
  WHERE role::TEXT = p_role AND section::TEXT = p_section AND permission::TEXT = p_permission;
  

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'permission',
      p_new_values := jsonb_build_object('role', p_role, 'section', p_section, 'permission', p_permission),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated permission',
      p_tags := ARRAY['admin', 'permission', 'update'],
      p_user_id := auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.revoke_permission_admin(p_role text, p_section text, p_permission text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_permission_admin(p_role text, p_section text, p_permission text) TO authenticated;
