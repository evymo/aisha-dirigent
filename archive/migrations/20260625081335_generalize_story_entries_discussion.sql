-- ============================================================================
-- Generalize story_entries into a polymorphic DISCUSSION node
-- ============================================================================
-- An article is a story/record under which discussion can happen — exactly like
-- the KB (knowledge_topics + knowledge_posts). aisha already had the threaded,
-- audited discussion primitive (story_entries) but bound it to partner_stories
-- only. This generalizes it to (subject_type, subject_id) so ANY content node —
-- news_article, knowledge_topic, web_page, story — hosts the same threaded,
-- moderated, audited discussion: one fabric instead of per-type comment tables.
-- Generic capability → flows upstream to base aisha.
--
-- Source of truth pair:
--   aisha/db/sql/tables/story_entries.sql
--   aisha/db/sql/functions/create_discussion_entry_audited.sql
-- ============================================================================

-- 1) Polymorphic subject binding + moderation state on story_entries.
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS subject_type      text;
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS subject_id        uuid;
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'visible';
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS moderation_reason text;

-- Backfill existing story entries into the polymorphic binding (idempotent).
UPDATE public.story_entries SET subject_type = 'story', subject_id = story_id
  WHERE subject_type IS NULL AND story_id IS NOT NULL;

-- Enforce the generic binding going forward; story_id becomes optional (legacy).
ALTER TABLE public.story_entries ALTER COLUMN subject_type SET DEFAULT 'story';
ALTER TABLE public.story_entries ALTER COLUMN subject_type SET NOT NULL;
ALTER TABLE public.story_entries ALTER COLUMN subject_id   SET NOT NULL;
ALTER TABLE public.story_entries ALTER COLUMN story_id     DROP NOT NULL;

ALTER TABLE public.story_entries DROP CONSTRAINT IF EXISTS story_entries_status_chk;
ALTER TABLE public.story_entries ADD  CONSTRAINT story_entries_status_chk
  CHECK (status IN ('visible','hidden','flagged','deleted'));

CREATE INDEX IF NOT EXISTS idx_story_entries_subject
  ON public.story_entries (subject_type, subject_id);

-- 2) Generic "discussion under any content node" post RPC.
CREATE OR REPLACE FUNCTION public.create_discussion_entry_audited(
  p_subject_type text,
  p_subject_id   uuid,
  p_content      text,
  p_entry_type   text  DEFAULT 'comment',
  p_parent_id    uuid  DEFAULT NULL,
  p_metadata     jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user_id  uuid;
  v_ok       boolean := false;
  v_entry_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_content IS NULL OR length(btrim(p_content)) = 0 THEN
    RAISE EXCEPTION 'Empty discussion content';
  END IF;

  CASE p_subject_type
    WHEN 'news_article' THEN
      SELECT true INTO v_ok FROM public.news_articles   WHERE id = p_subject_id AND is_published;
    WHEN 'knowledge_topic' THEN
      SELECT true INTO v_ok FROM public.knowledge_topics WHERE id = p_subject_id AND visibility IN ('public','members');
    WHEN 'web_page' THEN
      SELECT true INTO v_ok FROM public.web_pages        WHERE id = p_subject_id;
    WHEN 'story' THEN
      SELECT true INTO v_ok FROM public.partner_stories  WHERE id = p_subject_id;
    ELSE
      RAISE EXCEPTION 'Unsupported subject_type: %', p_subject_type;
  END CASE;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Subject not found or not discussable: % %', p_subject_type, p_subject_id;
  END IF;

  IF p_parent_id IS NOT NULL THEN
    PERFORM 1 FROM public.story_entries
      WHERE id = p_parent_id AND subject_type = p_subject_type AND subject_id = p_subject_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent entry % is not on this subject', p_parent_id;
    END IF;
  END IF;

  INSERT INTO public.story_entries (
    subject_type, subject_id, story_id, parent_id, entry_type, content, metadata, status, is_internal, created_by
  ) VALUES (
    p_subject_type, p_subject_id,
    CASE WHEN p_subject_type = 'story' THEN p_subject_id ELSE NULL END,
    p_parent_id, COALESCE(p_entry_type, 'comment'), p_content, COALESCE(p_metadata, '{}'::jsonb),
    'visible', false, v_user_id
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
  VALUES (v_user_id, 'discussion_entry.created', 'create', 'member',
    jsonb_build_object('entry_id', v_entry_id, 'subject_type', p_subject_type,
                       'subject_id', p_subject_id, 'is_reply', p_parent_id IS NOT NULL));

  RETURN v_entry_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) TO service_role;

-- 3) Members may READ visible public-content discussion (articles + pages).
--    Story + knowledge_topic entries keep their own (restrictive) policies;
--    knowledge_topic discussion-read (visibility-respecting) is a follow-up.
DROP POLICY IF EXISTS story_entries_public_discussion_read ON public.story_entries;
CREATE POLICY story_entries_public_discussion_read ON public.story_entries
  FOR SELECT TO authenticated
  USING (status = 'visible' AND is_internal = false AND subject_type IN ('news_article','web_page'));

-- Audit
INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
VALUES (NULL, 'generalize_story_entries_discussion.applied', 'create', 'platform',
  jsonb_build_object('migration', '20260625081335_generalize_story_entries_discussion', 'breaking_changes', false));
