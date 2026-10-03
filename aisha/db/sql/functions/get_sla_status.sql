CREATE OR REPLACE FUNCTION public.get_sla_status(
  p_story_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  story_id uuid,
  matrix_room_id text,
  first_message_at timestamptz,
  first_response_at timestamptz,
  response_time_ms integer,
  sla_breached boolean,
  escalated_at timestamptz,
  escalated_to uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT st.id, st.story_id, st.matrix_room_id, st.first_message_at,
         st.first_response_at, st.response_time_ms, st.sla_breached,
         st.escalated_at, st.escalated_to, st.created_at
  FROM sla_tracking st
  WHERE st.story_id = p_story_id
  ORDER BY st.created_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sla_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sla_status(uuid) TO authenticated;
