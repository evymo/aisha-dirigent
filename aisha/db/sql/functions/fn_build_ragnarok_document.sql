-- ============================================================================
-- Source of Truth: fn_build_ragnarok_document
-- Popis: Sestaví strukturovaný markdown dokument z řádku knowledge_items nebo
--        expert_rules pro upload do Ragnarok KB. Volá ji WF_KB_RAGNAROK_SYNC
--        node "Build Ragnarok Document" (ks-build-003) hned po Parse Change
--        Event — bez ní workflow padá na druhém kroku (PGRST202).
-- Bezpečnost: SECURITY DEFINER + service_role only (volá z n8n workflow).
--
-- Pozn.: Tento SoT soubor byl doplněn dodatečně — funkce dosud existovala jen
--        v migraci 20260429000000_fn_build_ragnarok_document.sql (pending), bez
--        SoT páru. To je latentní bug: při příštím `db:init:generate` se baseline
--        regeneruje z SoT, a funkce bez SoT páru by z baseline zmizela → návrat
--        PGRST202. DDL je drženo BYTE-IDENTICKÉ s migrací.
-- Vrací: jsonb { filename, source_type='txt', mime='text/markdown',
--               file_content, metadata }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_build_ragnarok_document(
  p_source_table text,
  p_source_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_filename text;
  v_content text;
  v_metadata jsonb;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_source_table = 'expert_rules' THEN
    SELECT
      'rule-' || er.slug || '.md',
      -- Markdown structure: title heading + summary + ai_instructions + body
      '# ' || COALESCE(er.title, er.slug) || E'\n\n' ||
      CASE WHEN er.summary IS NOT NULL AND er.summary <> ''
           THEN '> ' || er.summary || E'\n\n'
           ELSE '' END ||
      CASE WHEN er.ai_instructions IS NOT NULL AND er.ai_instructions <> ''
           THEN '## AI Instructions' || E'\n\n' || er.ai_instructions || E'\n\n'
           ELSE '' END ||
      CASE WHEN er.body_markdown IS NOT NULL AND er.body_markdown <> ''
           THEN '## Content' || E'\n\n' || er.body_markdown
           ELSE '' END,
      jsonb_build_object(
        'title', er.title,
        'slug', er.slug,
        'category', er.category::text,
        'tags', to_jsonb(COALESCE(er.ai_context_tags, ARRAY[]::text[])),
        'visibility', er.visibility,
        'version', er.version,
        'author_partner_id', er.author_partner_id,
        'source_table', 'expert_rules',
        'source_id', er.id
      )
    INTO v_filename, v_content, v_metadata
    FROM public.expert_rules er
    WHERE er.id = p_source_id;

  ELSIF p_source_table = 'knowledge_items' THEN
    SELECT
      'ki-' || COALESCE(ki.source_slug, ki.id::text) || '.md',
      '# ' || COALESCE(ki.title, ki.source_slug) || E'\n\n' ||
      CASE WHEN ki.summary IS NOT NULL AND ki.summary <> ''
           THEN '> ' || ki.summary || E'\n\n'
           ELSE '' END ||
      CASE WHEN ki.ai_instructions IS NOT NULL AND ki.ai_instructions <> ''
           THEN '## AI Instructions' || E'\n\n' || ki.ai_instructions || E'\n\n'
           ELSE '' END ||
      CASE WHEN ki.body_markdown IS NOT NULL AND ki.body_markdown <> ''
           THEN '## Content' || E'\n\n' || ki.body_markdown
           ELSE '' END,
      jsonb_build_object(
        'title', ki.title,
        'source_slug', ki.source_slug,
        'category', ki.category,
        'tags', to_jsonb(COALESCE(ki.ai_context_tags, ARRAY[]::text[])),
        'visibility', ki.visibility,
        'item_type', ki.item_type::text,
        'story_id', ki.story_id,
        'source_table', 'knowledge_items',
        'source_id', ki.id
      )
    INTO v_filename, v_content, v_metadata
    FROM public.knowledge_items ki
    WHERE ki.id = p_source_id;

  ELSE
    RETURN jsonb_build_object(
      'error', 'Unsupported source_table: ' || p_source_table,
      'supported', jsonb_build_array('expert_rules', 'knowledge_items')
    );
  END IF;

  IF v_filename IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Row not found',
      'source_table', p_source_table,
      'source_id', p_source_id
    );
  END IF;

  RETURN jsonb_build_object(
    'filename', v_filename,
    'source_type', 'txt',
    'mime', 'text/markdown',
    'file_content', v_content,
    'metadata', v_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_build_ragnarok_document(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_build_ragnarok_document(text, uuid) TO service_role;

COMMENT ON FUNCTION public.fn_build_ragnarok_document(text, uuid) IS
  'Build structured markdown document from knowledge_items or expert_rules row for Ragnarok KB upload. Called by WF_KB_RAGNAROK_SYNC workflow.';
