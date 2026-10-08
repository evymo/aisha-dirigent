-- =============================================================================
-- create_story_matrix_room
-- =============================================================================
-- Insert a new story ↔ Matrix room mapping.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_story_matrix_room(
  p_bridge_type text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_matrix_room_id text DEFAULT NULL,
  p_room_type text DEFAULT 'general',
  p_story_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_story_id IS NULL OR p_matrix_room_id IS NULL THEN
    RAISE EXCEPTION 'Missing required parameters';
  END IF;
  -- ⛔ Audit vydání 2026-10-01 (B2): kdokoli přihlášený připojil Matrix místnost
  -- ke KTERÉKOLI story — cizí story pak v klientech ukazovala jeho místnost jako
  -- „obecnou“. Mapování mění story → zápisové právo.
  IF NOT public.can_access_story(p_story_id, true) THEN
    RAISE EXCEPTION 'Access denied: story owner or participant required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO story_matrix_rooms (story_id, matrix_room_id, room_type, bridge_type, display_name)
  VALUES (p_story_id, p_matrix_room_id, p_room_type, p_bridge_type, p_display_name)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_story_matrix_room(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_story_matrix_room(text, text, text, text, uuid) TO authenticated;
