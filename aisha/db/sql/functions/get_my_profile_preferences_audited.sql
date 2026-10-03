-- Function: public.get_my_profile_preferences_audited
-- Arguments: (none)
-- Description: Returns non-sensitive data profile preferences (language + currency) for the current user.
-- Security: SECURITY DEFINER (audited, authenticated only)

CREATE OR REPLACE FUNCTION public.get_my_profile_preferences_audited()
RETURNS TABLE(preferred_language text, preferred_currency text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'profile'::journal_area,
      p_details := jsonb_build_object('fields', ARRAY['preferred_language', 'preferred_currency']),
      p_entity_id := auth.uid()::text,
      p_entity_type := 'profile_preferences',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed profile preferences',
      p_tags := ARRAY['profile', 'preferences'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT p.preferred_language, p.preferred_currency
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_profile_preferences_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_preferences_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_preferences_audited() TO authenticated;
