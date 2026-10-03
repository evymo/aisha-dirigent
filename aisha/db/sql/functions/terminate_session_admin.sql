-- Function: public.terminate_session_admin
-- Arguments: p_session_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:50+01:00

CREATE OR REPLACE FUNCTION public.terminate_session_admin(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM user_sessions WHERE id = p_session_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'auth'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_session_id::text,
      p_entity_type := 'session',
      p_new_values := jsonb_build_object('session_id', p_session_id),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated session',
      p_tags := ARRAY['admin', 'session', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.terminate_session_admin(p_session_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminate_session_admin(p_session_id uuid) TO authenticated;
