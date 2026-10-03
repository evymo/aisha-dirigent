-- Function: mcp_get_knowledge_item

CREATE OR REPLACE FUNCTION public.mcp_get_knowledge_item(p_item_id uuid DEFAULT NULL::uuid, p_source_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', ki.id,
    'item_type', ki.item_type::text,
    'source_type', ki.source_type,
    'source_slug', ki.source_slug,
    'title', ki.title,
    'summary', ki.summary,
    'body_markdown', ki.body_markdown,
    'ai_instructions', ki.ai_instructions,
    'ai_context_tags', ki.ai_context_tags,
    'category', ki.category,
    'expertise_area_slug', gea.slug,
    'expertise_area_icon', gea.icon,
    'author_display_name', ki.author_display_name,
    'is_verified', ki.is_verified,
    'version', ki.version,
    'usage_count', ki.usage_count,
    'rating_avg', ki.rating_avg,
    'published_at', ki.published_at,
    'updated_at', ki.updated_at,
    'chunks', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'chunk_index', kc.chunk_index,
        'chunk_text', kc.chunk_text,
        'section_title', kc.section_title,
        'token_count', kc.token_count,
        'has_embedding', EXISTS(
          SELECT 1 FROM knowledge_embeddings ke WHERE ke.chunk_id = kc.id
        )
      ) ORDER BY kc.chunk_index)
      FROM knowledge_chunks kc
      WHERE kc.knowledge_item_id = ki.id),
      '[]'::jsonb
    ),
    'bindings', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'target_type', rb.target_type::text,
        'binding_type', rb.binding_type,
        'priority', rb.priority
      ))
      FROM rule_bindings rb
      WHERE rb.rule_id = ki.source_id AND rb.is_active = true),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM knowledge_items ki
  LEFT JOIN guild_expertise_areas gea ON gea.id = ki.expertise_area_id
  WHERE ki.status = 'active'
    AND ki.visibility IN ('public', 'members')
    -- Brick6 tier-ACL. Gate single-item retrieval by the caller's audience tier,
    -- mirroring the HARD filter in mcp_search_knowledge_v2/v3 — an under-tier caller
    -- must never fetch a gated item by id/slug. Pinned to auth.uid() with NO
    -- service_role override, same rationale as the story-isolation block below: the
    -- MCP get_knowledge_item tool dispatches this as service_role (auth.uid() NULL),
    -- so tier-gated items collapse to ungated-only there — fail-closed is correct.
    AND (
      ki.minimum_tier IS NULL
      OR public.audience_user_meets_tier_requirement(ki.minimum_tier, auth.uid())
    )
    -- Per-story isolation. Story-scoped items default to visibility='public'
    -- (upsert_story_knowledge_item_audited), so the visibility filter alone would
    -- hand any anon/authenticated caller another story's full body_markdown +
    -- ai_instructions + chunk_text by id/slug. Global items (story_id IS NULL)
    -- stay public; story-scoped items only go to owner/participant/admin.
    -- Deliberately NO service_role bypass: the MCP get_knowledge_item tool
    -- dispatches this as service_role (auth.uid() NULL), so story items collapse
    -- to global-only there — the correct behaviour for a global KB accessor.
    AND (
      ki.story_id IS NULL
      OR public.is_admin_or_staff(auth.uid())
      OR EXISTS (
        SELECT 1 FROM partner_stories ps
        WHERE ps.id = ki.story_id AND ps.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM story_participants sp
        WHERE sp.story_id = ki.story_id AND sp.user_id = auth.uid()
      )
    )
    AND (
      (p_item_id IS NOT NULL AND ki.id = p_item_id)
      OR (p_source_slug IS NOT NULL AND ki.source_slug = p_source_slug)
    );

  -- Track usage
  IF v_result IS NOT NULL THEN
    UPDATE knowledge_items SET usage_count = usage_count + 1
    WHERE id = (v_result->>'id')::uuid;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION mcp_get_knowledge_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_item(uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_item(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_item(uuid,text) TO service_role;
