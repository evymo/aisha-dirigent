-- Function: mcp_get_rule_detail
--
-- Viditelnost (2026-10-05, revize B1): pravidlo podle public.expert_rule_visible_to pro toho, PRO KOHO
-- se čte. Do 2026-10-05 tu stál vlastní výčet ('public', 'members') pro kohokoli — `members` šlo
-- anonymovi. Nástroj MCP volá servisní rolí a publikum předává z ověřeného tokenu (p_audience_user_id);
-- služba bez publika = bez identity (jen `public`), přihlášený je připnutý na sebe.
-- Signatura se mění výměnou (přibyl parametr s výchozí hodnotou).
DROP FUNCTION IF EXISTS public.mcp_get_rule_detail(text);

CREATE OR REPLACE FUNCTION public.mcp_get_rule_detail(p_rule_slug text, p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_audience_user uuid;  -- pro koho se čte (služba smí říct; jinak volající sám; bez identity NULL)
BEGIN
  v_audience_user := CASE
    WHEN public.get_jwt_role() = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;

  SELECT jsonb_build_object(
    'id', er.id,
    'slug', er.slug,
    'title', er.title,
    'summary', er.summary,
    'body_markdown', er.body_markdown,
    'category', er.category::text,
    'expertise_area_slug', gea.slug,
    'expertise_area_name_key', gea.name_key,
    'expertise_area_icon', gea.icon,
    'author_display_name', pp.display_name,
    'author_guild_tier', pp.guild_tier,
    'ai_instructions', er.ai_instructions,
    'ai_context_tags', er.ai_context_tags,
    'is_verified', er.is_verified,
    'version', er.version,
    'rating_avg', er.rating_avg,
    'rating_count', er.rating_count,
    'usage_count', er.usage_count,
    'published_at', er.published_at,
    'updated_at', er.updated_at,
    'documents', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'title', erd.title,
        'description', erd.description,
        'content_markdown', erd.content_markdown,
        'document_type', erd.document_type,
        'sort_order', erd.sort_order
      ) ORDER BY erd.sort_order)
      FROM expert_rule_documents erd
      WHERE erd.rule_id = er.id),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM expert_rules er
  JOIN partner_profiles pp ON pp.id = er.author_partner_id
  LEFT JOIN guild_expertise_areas gea ON gea.id = er.expertise_area_id
  WHERE er.slug = p_rule_slug
    AND er.status = 'published'
    -- Viditelnost pro toho, pro koho se čte (autor své, správa vše, ostatní podle domova).
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_audience_user);

  -- Track usage
  IF v_result IS NOT NULL THEN
    UPDATE expert_rules SET usage_count = usage_count + 1
    WHERE slug = p_rule_slug;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_get_rule_detail(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_get_rule_detail(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_rule_detail(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_rule_detail(text, uuid) TO service_role;
