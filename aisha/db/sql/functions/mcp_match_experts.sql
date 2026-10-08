-- Function: mcp_match_experts
--
-- Viditelnost (2026-10-05, revize B1): počty pravidel autora jen z pravidel, která volající smí vidět
-- (public.expert_rule_visible_to). Nástroj MCP volá servisní rolí bez publika → počty z veřejných pravidel.

CREATE OR REPLACE FUNCTION public.mcp_match_experts(p_expertise_slug text DEFAULT NULL::text, p_context_tags text[] DEFAULT '{}'::text[], p_min_proficiency integer DEFAULT 1, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(expert_row ORDER BY expert_row->>'relevance_score' DESC)
    FROM (
      SELECT jsonb_build_object(
        'partner_id', pp.id,
        'display_name', pp.display_name,
        'avatar_url', pp.avatar_url,
        'guild_tier', pp.guild_tier,
        'guild_bio', pp.guild_bio,
        'expertise_area_slug', gea.slug,
        'expertise_area_name_key', gea.name_key,
        'proficiency_level', gme.proficiency_level,
        'published_rules_count', (
          SELECT count(*) FROM expert_rules er2
          WHERE er2.author_partner_id = pp.id AND er2.status = 'published'
            AND public.expert_rule_visible_to(er2.visibility, er2.author_partner_id, auth.uid())
        ),
        'matching_rules_count', (
          SELECT count(*) FROM expert_rules er3
          WHERE er3.author_partner_id = pp.id
            AND er3.status = 'published'
            AND public.expert_rule_visible_to(er3.visibility, er3.author_partner_id, auth.uid())
            AND (p_context_tags = '{}' OR er3.ai_context_tags && p_context_tags)
        ),
        'relevance_score', (
          gme.proficiency_level * 10
          -- Úrovně = hodnoty enumu guild_tier. Do 2026-10-05 tu stála i 'expert', kterou enum nemá:
          -- literál se převádí na enum při plánování, takže KAŽDÉ volání skončilo chybou 22P02
          -- (změřeno maticí pravidel src/tests/db/pravidla-viditelnost-cesta-identita).
          + CASE WHEN pp.guild_tier = 'grandmaster' THEN 50
                 WHEN pp.guild_tier = 'master' THEN 40
                 WHEN pp.guild_tier = 'journeyman' THEN 20
                 WHEN pp.guild_tier = 'apprentice' THEN 10
                 ELSE 0 END
          + (SELECT count(*) FROM expert_rules er4
             WHERE er4.author_partner_id = pp.id
               AND er4.status = 'published'
               AND public.expert_rule_visible_to(er4.visibility, er4.author_partner_id, auth.uid())
               AND er4.is_verified = true) * 5
        )
      ) AS expert_row
      FROM guild_member_expertise gme
      JOIN partner_profiles pp ON pp.id = gme.partner_id
      JOIN guild_expertise_areas gea ON gea.id = gme.expertise_area_id
      WHERE gea.is_active = true
        AND gme.proficiency_level >= p_min_proficiency
        AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
      ORDER BY gme.proficiency_level DESC, pp.guild_tier DESC
      LIMIT p_limit
    ) sub),
    '[]'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_match_experts(text, text[], integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_match_experts(text,text[],integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION mcp_match_experts(text,text[],integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_match_experts(text,text[],integer,integer) TO service_role;
