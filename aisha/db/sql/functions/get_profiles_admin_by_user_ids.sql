-- Function: public.get_profiles_admin_by_user_ids
-- Arguments: p_user_ids uuid[]
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:25+01:00

CREATE OR REPLACE FUNCTION public.get_profiles_admin_by_user_ids(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, display_name text, email text, phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := jsonb_build_object(
      'count', COALESCE(array_length(p_user_ids, 1), 0)
    ),
      p_entity_id := NULL,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin fetched minimal profiles by user ids',
      p_tags := ARRAY['admin', 'profiles', 'min'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    p.user_id,
    p.display_name,
    p.email,
    p.phone
  FROM public.profiles p
  WHERE p.user_id = ANY(p_user_ids)
  ORDER BY p.display_name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_profiles_admin_by_user_ids(p_user_ids uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_profiles_admin_by_user_ids(p_user_ids uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_admin_by_user_ids(p_user_ids uuid[]) TO authenticated;
