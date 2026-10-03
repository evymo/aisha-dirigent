-- Function: public.get_all_questionnaires_admin
-- Description: Returns active questionnaires for admin dropdowns with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_all_questionnaires_admin()
 RETURNS TABLE(code text, description_key text, id uuid, is_active boolean, name text, token_reward int4)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_entity_type := 'questionnaire',
      p_summary := 'Admin listed all active questionnaires',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    q.code,
    COALESCE(q.description_key, '') AS description_key,
    q.id,
    q.is_active,
    q.name,
    COALESCE(q.token_reward, 0)::NUMERIC AS token_reward
  FROM questionnaires q
  WHERE q.is_active = TRUE
  ORDER BY q.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_all_questionnaires_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_questionnaires_admin() TO authenticated;
