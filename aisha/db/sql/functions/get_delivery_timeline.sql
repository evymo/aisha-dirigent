-- Function: get_delivery_timeline

CREATE OR REPLACE FUNCTION public.get_delivery_timeline(p_story_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, from_status text, to_status text, triggered_by uuid, trigger_source text, metadata jsonb, created_at timestamptz, triggered_by_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization: participant or staff
  IF NOT EXISTS (
    SELECT 1 FROM story_participants sp
    WHERE sp.story_id = p_story_id AND sp.user_id = auth.uid()
  ) AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    dt.id,
    dt.from_status,
    dt.to_status,
    dt.triggered_by,
    dt.trigger_source,
    dt.metadata,
    dt.created_at,
    u.email AS triggered_by_email
  FROM delivery_transitions dt
  LEFT JOIN aisha_auth.users u ON u.id = dt.triggered_by
  WHERE dt.story_id = p_story_id
  ORDER BY dt.created_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$function$;

REVOKE ALL ON FUNCTION get_delivery_timeline(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_delivery_timeline(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_delivery_timeline(uuid,integer) TO service_role;
