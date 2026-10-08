-- Function: public.get_expert_rules
-- Arguments: p_category text DEFAULT NULL::text, p_expertise_slug text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_author_partner_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)
-- Viditelnost (2026-10-05, revize B1): public.expert_rule_visible_to pro volajícího (domov viditelnosti;
-- autor své, správa vše). Do 2026-10-05 tu stál vlastní výčet viditelností s vlastní definicí gildy.

CREATE OR REPLACE FUNCTION public.get_expert_rules(p_category text DEFAULT NULL::text, p_expertise_slug text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_author_partner_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, title text, summary text, category text, expertise_area_slug text, expertise_area_name_key text, expertise_area_icon text, author_partner_id uuid, author_display_name text, author_avatar_url text, author_guild_tier text, is_verified boolean, subscriber_count integer, usage_count integer, rating_avg numeric, rating_count integer, document_count bigint, ai_context_tags text[], published_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    er.id,
    er.slug,
    er.title,
    er.summary,
    er.category::text,
    gea.slug AS expertise_area_slug,
    gea.name_key AS expertise_area_name_key,
    gea.icon AS expertise_area_icon,
    er.author_partner_id,
    pp.display_name AS author_display_name,
    pp.avatar_url AS author_avatar_url,
    pp.guild_tier::text AS author_guild_tier,
    er.is_verified,
    er.subscriber_count,
    er.usage_count,
    er.rating_avg,
    er.rating_count,
    (SELECT count(*) FROM expert_rule_documents erd WHERE erd.rule_id = er.id) AS document_count,
    er.ai_context_tags,
    er.published_at,
    er.created_at
  FROM expert_rules er
  LEFT JOIN guild_expertise_areas gea ON gea.id = er.expertise_area_id
  JOIN partner_profiles pp ON pp.id = er.author_partner_id
  WHERE er.status = 'published'
    -- Viditelnost pro volajícího (seznam čte web napřímo; publikum = volající sám).
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
    AND (p_category IS NULL OR er.category::text = p_category)
    AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
    AND (p_author_partner_id IS NULL OR er.author_partner_id = p_author_partner_id)
    AND (p_search IS NULL OR p_search = '' OR
      er.title ILIKE '%' || p_search || '%' OR
      er.summary ILIKE '%' || p_search || '%' OR
      p_search = ANY(er.ai_context_tags)
    )
  ORDER BY er.is_verified DESC, er.rating_avg DESC NULLS LAST, er.subscriber_count DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_expert_rules(text, text, text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expert_rules(text, text, text, uuid, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_expert_rules(text, text, text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expert_rules(text, text, text, uuid, integer, integer) TO service_role;
