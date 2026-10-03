-- Function: public.get_expertise_areas
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_expertise_areas()
 RETURNS TABLE(id uuid, slug text, name_key text, description_key text, icon text, parent_id uuid, sort_order integer, member_count bigint, rule_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    gea.id, gea.slug, gea.name_key, gea.description_key, gea.icon, gea.parent_id, gea.sort_order,
    (SELECT count(DISTINCT gme.partner_id) FROM guild_member_expertise gme WHERE gme.expertise_area_id = gea.id) AS member_count,
    (SELECT count(*) FROM expert_rules er WHERE er.expertise_area_id = gea.id AND er.status = 'published') AS rule_count
  FROM guild_expertise_areas gea
  WHERE gea.is_active = true
  ORDER BY gea.sort_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_expertise_areas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expertise_areas() TO anon;
GRANT EXECUTE ON FUNCTION public.get_expertise_areas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expertise_areas() TO service_role;
