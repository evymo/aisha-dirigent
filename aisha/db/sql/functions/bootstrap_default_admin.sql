-- Function: public.bootstrap_default_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:54+01:00

CREATE OR REPLACE FUNCTION public.bootstrap_default_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'system_config',
      p_new_values := jsonb_build_object('admin_count', v_admin_count),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'User checked default admin status',
      p_tags := ARRAY['system', 'bootstrap'],
      p_user_id := auth.uid()
  );

  IF v_admin_count > 0 THEN
    RETURN jsonb_build_object('success', true, 'message', 'Admin user already exists', 'admin_count', v_admin_count);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'No admin user exists. Please create one manually.', 'admin_count', 0);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.bootstrap_default_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_default_admin() TO authenticated;
