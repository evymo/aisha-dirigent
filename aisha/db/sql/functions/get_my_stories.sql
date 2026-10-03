-- Stub: returns stories belonging to the calling user.
-- TODO: Expand with full story model (story_assignments, story_timeline, etc.)
-- Currently returns an empty result set until the Story data model is integrated.
CREATE OR REPLACE FUNCTION public.get_my_stories()
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Placeholder: will query story_assignments + stories tables when available
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION get_my_stories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_stories() TO authenticated;
