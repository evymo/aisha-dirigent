-- Function: public.get_guild_member_detail
-- Arguments: p_partner_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_guild_member_detail(p_partner_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, display_name text, avatar_url text, business_name text, description text, guild_tier guild_tier, guild_bio text, expertise_summary text, city text, country text, website text, certification_level text, is_production_provider boolean, guild_joined_at timestamptz, services text[], languages text[], expertise_areas jsonb, published_rules jsonb)
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
    pp.business_name,
    pp.description,
    pp.guild_tier,
    pp.guild_bio,
    pp.expertise_summary,
    pp.city,
    pp.country,
    pp.website,
    pp.certification_level::text,
    pp.is_production_provider,
    pp.guild_joined_at,
    pp.services,
    pp.languages,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', gea.id,
        'slug', gea.slug,
        'name_key', gea.name_key,
        'icon', gea.icon,
        'proficiency_level', gme.proficiency_level,
        'years_experience', gme.years_experience,
        'description', gme.description,
        'is_primary', gme.is_primary
      ) ORDER BY gme.is_primary DESC, gme.proficiency_level DESC)
      FROM guild_member_expertise gme
      JOIN guild_expertise_areas gea ON gea.id = gme.expertise_area_id
      WHERE gme.partner_id = pp.id),
      '[]'::jsonb
    ) AS expertise_areas,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', er.id,
        'slug', er.slug,
        'title', er.title,
        'summary', er.summary,
        'category', er.category,
        'subscriber_count', er.subscriber_count,
        'rating_avg', er.rating_avg,
        'rating_count', er.rating_count,
        'published_at', er.published_at
      ) ORDER BY er.published_at DESC NULLS LAST)
      FROM expert_rules er
      WHERE er.author_partner_id = pp.id AND er.status = 'published'
        -- veřejný profil člena: jen pravidla bez identity viditelná (jen `public`)
        AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, NULL::uuid)),
      '[]'::jsonb
    ) AS published_rules
  FROM partner_profiles pp
  WHERE pp.id = p_partner_id AND pp.is_visible = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_guild_member_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guild_member_detail(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guild_member_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_member_detail(uuid) TO service_role;
