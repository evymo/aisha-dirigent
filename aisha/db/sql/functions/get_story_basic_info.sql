-- =============================================================================
-- get_story_basic_info
-- =============================================================================
-- Get minimal story info (id + title) for room naming.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_story_basic_info(
  p_story_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text
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
  SELECT s.id, s.title
  FROM stories s
  WHERE s.id = p_story_id
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_basic_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_basic_info(uuid) TO authenticated;
