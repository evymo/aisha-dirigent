-- =============================================================================
-- get_story_matrix_rooms
-- =============================================================================
-- List active Matrix rooms for a story (optional filter).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_story_matrix_rooms(
  p_story_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  story_id uuid,
  matrix_room_id text,
  room_type text,
  bridge_type text,
  display_name text,
  is_active boolean,
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

  IF p_story_id IS NOT NULL THEN
    -- Room *metadata* is guarded by an RLS policy on the table, but this function
    -- is SECURITY DEFINER and so runs past it. Re-assert the same rule here: only a
    -- participant of THIS story (or admin/staff) may see its room mappings.
    IF NOT (public.is_admin_or_staff(v_user_id)
            OR public.is_story_participant(v_user_id, p_story_id)) THEN
      RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
        USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT smr.id, smr.story_id, smr.matrix_room_id, smr.room_type::text,
           smr.bridge_type, smr.display_name, smr.is_active, smr.created_at
    FROM story_matrix_rooms smr
    WHERE smr.is_active = true
      AND smr.story_id = p_story_id
    ORDER BY smr.created_at DESC;
  ELSE
    -- "My rooms" (MatrixInbox): every mapping the caller is entitled to. Without
    -- this filter a NULL argument returned every room on the instance — a
    -- cross-story metadata leak to any authenticated user.
    RETURN QUERY
    SELECT smr.id, smr.story_id, smr.matrix_room_id, smr.room_type::text,
           smr.bridge_type, smr.display_name, smr.is_active, smr.created_at
    FROM story_matrix_rooms smr
    WHERE smr.is_active = true
      AND (
        public.is_admin_or_staff(v_user_id)
        OR EXISTS (
          SELECT 1 FROM story_participants sp
          WHERE sp.story_id = smr.story_id
            AND sp.user_id = v_user_id
        )
      )
    ORDER BY smr.created_at DESC;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_matrix_rooms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_matrix_rooms(uuid) TO authenticated;
