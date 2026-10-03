-- ============================================================================
-- Discussion read path + template-driven entry-type registry
-- ============================================================================
-- Step 2 of "discussion under any node": the READ surface (get_discussion_entries,
-- threaded) and the TYPE SYSTEM (entry_type_definitions) that drives
-- story_entries.entry_type the way the runtime-block registry drives web blocks.
-- The stack ships universal types (comment, question); implementations seed their
-- own (e.g. a community instance's practice-share) into the SAME catalog. The post RPC now validates
-- entry_type against the active registry. Generic → flows upstream.
--
-- Source of truth pair:
--   aisha/db/sql/tables/entry_type_definitions.sql
--   aisha/db/sql/policies/entry_type_definitions__read.sql
--   aisha/db/sql/functions/{get_entry_types,get_discussion_entries,create_discussion_entry_audited}.sql
-- Seed (data): aisha/db/seed/core/35_entry_types.sql + the instance overlay's entry types
-- ============================================================================

-- 1) Entry-type registry (the template/catalog for post types).
CREATE TABLE IF NOT EXISTS public.entry_type_definitions (
  entry_type       text         PRIMARY KEY,
  name_key         text         NOT NULL,
  description_key  text,
  applies_to       text[]       NOT NULL DEFAULT '{}'::text[],
  metadata_schema  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  render_block     text,
  is_active        boolean      NOT NULL DEFAULT true,
  sort_order       integer      NOT NULL DEFAULT 100,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entry_type_definitions_active ON public.entry_type_definitions (is_active, sort_order);
ALTER TABLE public.entry_type_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entry_type_definitions_read" ON public.entry_type_definitions;
CREATE POLICY "entry_type_definitions_read" ON public.entry_type_definitions
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_active = true);
DROP POLICY IF EXISTS "entry_type_definitions_service" ON public.entry_type_definitions;
CREATE POLICY "entry_type_definitions_service" ON public.entry_type_definitions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) List active post types for a subject.
CREATE OR REPLACE FUNCTION public.get_entry_types(p_subject_type text DEFAULT NULL)
RETURNS TABLE(entry_type text, name_key text, description_key text, metadata_schema jsonb, render_block text, sort_order integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT d.entry_type, d.name_key, d.description_key, d.metadata_schema, d.render_block, d.sort_order
    FROM public.entry_type_definitions d
    WHERE d.is_active
      AND (p_subject_type IS NULL OR cardinality(d.applies_to) = 0 OR p_subject_type = ANY(d.applies_to))
    ORDER BY d.sort_order, d.entry_type;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_entry_types(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_entry_types(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_entry_types(text) TO service_role;

-- 3) Threaded READ of a public node's discussion.
CREATE OR REPLACE FUNCTION public.get_discussion_entries(p_subject_type text, p_subject_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, parent_id uuid, entry_type text, content text, metadata jsonb, created_by uuid, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ok boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  CASE p_subject_type
    WHEN 'news_article' THEN SELECT true INTO v_ok FROM public.news_articles na WHERE na.id = p_subject_id AND na.is_published;
    WHEN 'web_page'     THEN SELECT true INTO v_ok FROM public.web_pages wp     WHERE wp.id = p_subject_id;
    ELSE v_ok := false;
  END CASE;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Subject not found or not publicly discussable: % %', p_subject_type, p_subject_id;
  END IF;
  RETURN QUERY
    SELECT e.id, e.parent_id, e.entry_type, e.content, e.metadata, e.created_by, e.created_at
    FROM public.story_entries e
    WHERE e.subject_type = p_subject_type AND e.subject_id = p_subject_id
      AND e.status = 'visible' AND e.is_internal = false
    ORDER BY e.created_at ASC
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_discussion_entries(text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_discussion_entries(text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discussion_entries(text, uuid, integer, integer) TO service_role;

-- 4) Post RPC now validates entry_type against the active registry.
CREATE OR REPLACE FUNCTION public.create_discussion_entry_audited(p_subject_type text, p_subject_id uuid, p_content text, p_entry_type text DEFAULT 'comment', p_parent_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_user_id uuid; v_ok boolean := false; v_entry_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_content IS NULL OR length(btrim(p_content)) = 0 THEN RAISE EXCEPTION 'Empty discussion content'; END IF;
  CASE p_subject_type
    WHEN 'news_article'    THEN SELECT true INTO v_ok FROM public.news_articles   WHERE id = p_subject_id AND is_published;
    WHEN 'knowledge_topic' THEN SELECT true INTO v_ok FROM public.knowledge_topics WHERE id = p_subject_id AND visibility IN ('public','members');
    WHEN 'web_page'        THEN SELECT true INTO v_ok FROM public.web_pages        WHERE id = p_subject_id;
    WHEN 'story'           THEN SELECT true INTO v_ok FROM public.partner_stories  WHERE id = p_subject_id;
    ELSE RAISE EXCEPTION 'Unsupported subject_type: %', p_subject_type;
  END CASE;
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'Subject not found or not discussable: % %', p_subject_type, p_subject_id; END IF;
  PERFORM 1 FROM public.entry_type_definitions d
    WHERE d.entry_type = COALESCE(p_entry_type, 'comment') AND d.is_active
      AND (cardinality(d.applies_to) = 0 OR p_subject_type = ANY(d.applies_to));
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inapplicable entry_type: % (subject %)', COALESCE(p_entry_type,'comment'), p_subject_type; END IF;
  IF p_parent_id IS NOT NULL THEN
    PERFORM 1 FROM public.story_entries WHERE id = p_parent_id AND subject_type = p_subject_type AND subject_id = p_subject_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent entry % is not on this subject', p_parent_id; END IF;
  END IF;
  INSERT INTO public.story_entries (subject_type, subject_id, story_id, parent_id, entry_type, content, metadata, status, is_internal, created_by)
  VALUES (p_subject_type, p_subject_id, CASE WHEN p_subject_type='story' THEN p_subject_id ELSE NULL END, p_parent_id, COALESCE(p_entry_type,'comment'), p_content, COALESCE(p_metadata,'{}'::jsonb), 'visible', false, v_user_id)
  RETURNING id INTO v_entry_id;
  INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
  VALUES (v_user_id, 'discussion_entry.created', 'create', 'member',
    jsonb_build_object('entry_id', v_entry_id, 'subject_type', p_subject_type, 'subject_id', p_subject_id, 'entry_type', COALESCE(p_entry_type,'comment'), 'is_reply', p_parent_id IS NOT NULL));
  RETURN v_entry_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_discussion_entry_audited(text, uuid, text, text, uuid, jsonb) TO service_role;

INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
VALUES (NULL, 'discussion_read_and_entry_type_registry.applied', 'create', 'platform',
  jsonb_build_object('migration', '20260625085951_discussion_read_and_entry_type_registry', 'breaking_changes', false));
