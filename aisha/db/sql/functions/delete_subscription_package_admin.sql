-- Function: public.delete_subscription_package_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:26+01:00

CREATE OR REPLACE FUNCTION public.delete_subscription_package_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  DELETE FROM subscription_packages WHERE id = p_id;

  IF FOUND THEN
    PERFORM public.write_audit_journal(
        p_action_type := 'delete'::public.journal_action_type,
        p_area := 'admin'::public.journal_area,
        p_details := NULL,
        p_entity_id := p_id::text,
        p_entity_type := 'subscription_package',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'warning'::public.journal_severity,
        p_summary := 'Deleted subscription package',
        p_tags := ARRAY['admin', 'subscription', 'delete'],
        p_user_id := auth.uid()
    );
  END IF;

  RETURN FOUND;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_subscription_package_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_subscription_package_admin(p_id uuid) TO authenticated;
