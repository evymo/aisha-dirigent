-- Function: public.get_guild_members
-- Arguments: p_expertise_slug text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_guild_members(p_expertise_slug text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, user_id uuid, display_name text, avatar_url text, guild_tier guild_tier, guild_bio text, expertise_summary text, city text, country text, certification_level text, is_production_provider boolean, guild_joined_at timestamptz, rules_count bigint, expertise_areas jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    pp.id,
    pp.user_id,
    pp.display_name,
    pp.avatar_url,
    pp.guild_tier,
    pp.guild_bio,
    pp.expertise_summary,
    pp.city,
    pp.country,
    pp.certification_level::text,
    pp.is_production_provider,
    pp.guild_joined_at,
    (SELECT count(*) FROM expert_rules er WHERE er.author_partner_id = pp.id AND er.status = 'published') AS rules_count,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', gea.id,
        'slug', gea.slug,
        'name_key', gea.name_key,
        'icon', gea.icon,
        'proficiency_level', gme.proficiency_level,
        'is_primary', gme.is_primary
      ) ORDER BY gme.is_primary DESC, gme.proficiency_level DESC)
      FROM guild_member_expertise gme
      JOIN guild_expertise_areas gea ON gea.id = gme.expertise_area_id
      WHERE gme.partner_id = pp.id),
      '[]'::jsonb
    ) AS expertise_areas
  FROM partner_profiles pp
  WHERE pp.is_visible = true
    AND pp.guild_tier IS NOT NULL
    AND (p_expertise_slug IS NULL OR EXISTS (
      SELECT 1 FROM guild_member_expertise gme2
      JOIN guild_expertise_areas gea2 ON gea2.id = gme2.expertise_area_id
      WHERE gme2.partner_id = pp.id AND gea2.slug = p_expertise_slug
    ))
    AND (p_search IS NULL OR p_search = '' OR
      pp.display_name ILIKE '%' || p_search || '%' OR
      pp.guild_bio ILIKE '%' || p_search || '%' OR
      pp.expertise_summary ILIKE '%' || p_search || '%'
    )
  ORDER BY
    CASE pp.guild_tier
      WHEN 'grandmaster' THEN 1
      WHEN 'master' THEN 2
      WHEN 'journeyman' THEN 3
      WHEN 'apprentice' THEN 4
    END,
    pp.display_name
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_guild_members(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guild_members(text, text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guild_members(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_members(text, text, integer, integer) TO service_role;
