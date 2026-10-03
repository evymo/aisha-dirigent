-- Function: public.get_my_profile_contact_prefill_audited
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:02+01:00

CREATE OR REPLACE FUNCTION public.get_my_profile_contact_prefill_audited()
 RETURNS TABLE(display_name text, email text, phone text, address jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Audit log
  PERFORM public.write_audit_journal(
    p_action_type := 'view'::journal_action_type,
    p_area := 'profile'::journal_area,
    p_details := jsonb_build_object('fields', ARRAY['display_name', 'email', 'phone', 'address']),
    p_entity_id := auth.uid()::text,
    p_entity_type := 'profile',
    p_new_values := NULL::jsonb,
    p_old_values := NULL::jsonb,
    p_severity := 'info'::journal_severity,
    p_summary := 'User viewed profile contact prefill',
    p_tags := ARRAY['profile', 'contact', 'prefill'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT p.display_name, p.email, p.phone, p.address::jsonb
  FROM profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_profile_contact_prefill_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_contact_prefill_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_contact_prefill_audited() TO authenticated;
