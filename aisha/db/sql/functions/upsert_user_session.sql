-- Function: public.upsert_user_session
-- Arguments: p_session_id text, p_user_agent text, p_ip_address text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:35+01:00

CREATE OR REPLACE FUNCTION public.upsert_user_session(p_session_id text, p_user_agent text, p_ip_address text DEFAULT NULL::text)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO user_sessions (user_id, session_id, user_agent, ip_address, last_active_at)
  VALUES (auth.uid(), p_session_id, p_user_agent, p_ip_address, now())
  ON CONFLICT (user_id, session_id) DO UPDATE SET
    last_active_at = now(),
    user_agent = EXCLUDED.user_agent,
    ip_address = COALESCE(EXCLUDED.ip_address, user_sessions.ip_address)
  RETURNING user_sessions.id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.upsert_user_session(p_session_id text, p_user_agent text, p_ip_address text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_session(p_session_id text, p_user_agent text, p_ip_address text) TO authenticated;
