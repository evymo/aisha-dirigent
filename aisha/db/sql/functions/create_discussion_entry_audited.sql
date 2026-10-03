-- ============================================================================
-- Source of Truth: public.create_discussion_entry_audited
-- Popis: Generic "discussion under any content node" post primitive. Any
--        authenticated member can thread a comment under a DISCUSSABLE subject
--        (news_article, knowledge_topic, web_page, story). Validates the subject
--        exists + is discussable per subject_type, enforces same-subject
--        threading, and audits. Replaces per-type comment tables with one
--        polymorphic story_entries row (subject_type, subject_id).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; auth.uid() required.
-- ============================================================================

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
AS $$
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

  -- Validate the subject exists AND is discussable (publicly readable) per type.
  -- subject_id is polymorphic (no FK) so this is the integrity gate.
  CASE p_subject_type
    WHEN 'news_article' THEN
      SELECT true INTO v_ok FROM public.news_articles  WHERE id = p_subject_id AND is_published;
    WHEN 'knowledge_topic' THEN
      SELECT true INTO v_ok FROM public.knowledge_topics WHERE id = p_subject_id AND visibility IN ('public','members');
    WHEN 'web_page' THEN
      -- draft web_pages are admin-only (web_pages.status: draft|published); a member must
      -- not comment on an unpublished page even if they guess its UUID. Mirrors the sibling
      -- per-type publication gates (news_article -> is_published).
      SELECT true INTO v_ok FROM public.web_pages       WHERE id = p_subject_id AND status = 'published';
    WHEN 'story' THEN
      SELECT true INTO v_ok FROM public.partner_stories WHERE id = p_subject_id;
    ELSE
      RAISE EXCEPTION 'Unsupported subject_type: %', p_subject_type;
  END CASE;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Subject not found or not discussable: % %', p_subject_type, p_subject_id;
  END IF;

  -- The post TYPE must be a registered, ACTIVE type valid for this subject —
  -- types are template/config-driven via entry_type_definitions (stack ships the
  -- universals; implementations add their own). Keeps entry_type from drifting.
  PERFORM 1 FROM public.entry_type_definitions d
    WHERE d.entry_type = COALESCE(p_entry_type, 'comment')
      AND d.is_active
      AND (cardinality(d.applies_to) = 0 OR p_subject_type = ANY(d.applies_to));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inapplicable entry_type: % (subject %)',
      COALESCE(p_entry_type, 'comment'), p_subject_type;
  END IF;

  -- Threading: a reply must target an entry on the SAME subject.
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
  VALUES (
    v_user_id, 'discussion_entry.created', 'create', 'member',
    jsonb_build_object(
      'entry_id', v_entry_id,
      'subject_type', p_subject_type,
      'subject_id', p_subject_id,
      'is_reply', p_parent_id IS NOT NULL
    )
  );

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) TO service_role;
