-- Function: get_allowed_transitions

CREATE OR REPLACE FUNCTION public.get_allowed_transitions(p_story_id uuid)
 RETURNS TABLE(to_status text, requires_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status text;
BEGIN
  -- Stráž (can_access_story.sql) — PŘED dohledáním, ať cizí a neexistující story vypadají stejně.
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
  END IF;

  SELECT delivery_status INTO v_current_status
  FROM partner_stories
  WHERE id = p_story_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT dtr.to_status, dtr.requires_role
  FROM delivery_transition_rules dtr
  WHERE dtr.is_active = true
    AND (dtr.from_status IS NOT DISTINCT FROM v_current_status)
  ORDER BY dtr.to_status;
END;
$function$;

REVOKE ALL ON FUNCTION get_allowed_transitions(p_story_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_allowed_transitions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_allowed_transitions(uuid) TO service_role;
