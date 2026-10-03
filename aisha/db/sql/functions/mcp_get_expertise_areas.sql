-- Function: mcp_get_expertise_areas

CREATE OR REPLACE FUNCTION public.mcp_get_expertise_areas()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'slug', gea.slug,
      'name_key', gea.name_key,
      'icon', gea.icon,
      'description_key', gea.description_key,
      'rule_count', (SELECT count(*) FROM expert_rules er WHERE er.expertise_area_id = gea.id AND er.status = 'published'),
      'expert_count', (SELECT count(DISTINCT gme.partner_id) FROM guild_member_expertise gme WHERE gme.expertise_area_id = gea.id)
    ) ORDER BY gea.sort_order)
    FROM guild_expertise_areas gea
    WHERE gea.is_active = true),
    '[]'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_get_expertise_areas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_get_expertise_areas() TO anon;
GRANT EXECUTE ON FUNCTION mcp_get_expertise_areas() TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_expertise_areas() TO service_role;
