-- ============================================================================
-- Source of Truth: public.get_discussion_entries
-- Popis: Threaded READ of the discussion under a PUBLIC content node (article /
--        web_page). Returns visible, non-internal entries with their author +
--        parent so the client can render the thread. SECURITY DEFINER bypasses
--        RLS, so access is enforced here: the subject must be publicly
--        discussable (mirrors story_entries__public_discussion_read) — this
--        function never exposes member-private story or internal entries.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; authenticated only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_discussion_entries(
  p_subject_type text,
  p_subject_id   uuid,
  p_limit        integer DEFAULT 100,
  p_offset       integer DEFAULT 0
)
RETURNS TABLE(
  id          uuid,
  parent_id   uuid,
  entry_type  text,
  content     text,
  metadata    jsonb,
  created_by  uuid,
  created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Only PUBLIC content nodes are readable through this generic surface.
  -- table aliases: this function's RETURNS TABLE has an OUT column `id`, so the
  -- subject-check WHERE must qualify the table column to avoid ambiguity.
  CASE p_subject_type
    WHEN 'news_article' THEN
      SELECT true INTO v_ok FROM public.news_articles na WHERE na.id = p_subject_id AND na.is_published;
    WHEN 'web_page' THEN
      -- draft web_pages are admin-only; the public read surface must not expose a draft's
      -- thread even to a member who guesses its UUID. Mirrors news_article -> is_published.
      SELECT true INTO v_ok FROM public.web_pages wp     WHERE wp.id = p_subject_id AND wp.status = 'published';
    ELSE
      v_ok := false;
  END CASE;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Subject not found or not publicly discussable: % %', p_subject_type, p_subject_id;
  END IF;

  RETURN QUERY
    SELECT e.id, e.parent_id, e.entry_type, e.content, e.metadata, e.created_by, e.created_at
    FROM public.story_entries e
    WHERE e.subject_type = p_subject_type
      AND e.subject_id   = p_subject_id
      AND e.status       = 'visible'
      AND e.is_internal  = false
    ORDER BY e.created_at ASC
    LIMIT  GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_discussion_entries(text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_discussion_entries(text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discussion_entries(text, uuid, integer, integer) TO service_role;
