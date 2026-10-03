-- =============================================================================
-- get_story_general_matrix_room
-- =============================================================================
-- Get the active general Matrix room mapping for a story.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_story_general_matrix_room(
  p_story_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  matrix_room_id text,
  room_type text
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
  -- ⛔ Audit vydání 2026-10-01 (B2): SECURITY DEFINER běží mimo RLS tabulky, takže
  -- id Matrix místnosti cizí story dostal každý přihlášený. Totéž pravidlo jako
  -- get_story_matrix_rooms, jeden predikát can_access_story.
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied: story owner or participant required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT smr.id, smr.matrix_room_id, smr.room_type::text
  FROM story_matrix_rooms smr
  WHERE smr.story_id = p_story_id
    AND smr.room_type = 'general'
    AND smr.is_active = true
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_general_matrix_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_general_matrix_room(uuid) TO authenticated;
