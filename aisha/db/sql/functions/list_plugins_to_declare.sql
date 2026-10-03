-- ============================================================================
-- Source of Truth: list_plugins_to_declare
-- Popis: Které pluginy má host „zapálit" — spustit v režimu jen-deklaruj (init
--        bez stahování), aby jejich rozvrhy vznikly v plugin_schedules.
--
-- ⛔ PROČ VZNIKÁ. Naměřeno 2026-09-24 v produkci RIQ: rozvrhy vznikaly jen po
-- úspěšném běhu pluginu, ale první běh nespouštělo nic → plugin_schedules = 0,
-- žádný plugin nikdy neběžel, přestože zdroje byly aktivní a měly pověření.
--
-- Kandidát = plugin, který JE v provozu (canary/ga, tentýž filtr jako katalog
-- hostu) a je napojený na AKTIVNÍ zdroj dat, jehož vlastník je znám, a zároveň:
--   · ještě nebyl zapálen pro tohoto tenanta, NEBO
--   · od posledního zapálení vyšla nová verze (nová verze může deklarovat jiné
--     rozvrhy — stará deklarace by jinak platila navždy), NEBO
--   · poslední zapálení selhalo a od té doby uběhlo p_retry_minutes (opakování,
--     ne smyčka každou minutou).
--
-- ⭐ TENANT = vlastník příběhu zdroje (partner_stories.user_id, jinak
-- partner_id). Zdroj bez vlastníka se NEZAPÁLÍ — hádat tenanta by znamenalo
-- spouštět cizí data pod náhodnou identitou. Takový zdroj ukáže hlídač stavu
-- zdrojů (get_data_source_feed_health) jako „bez vlastníka".
--
-- Bezpečnost: jen služba (svc-plugin-system).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_plugins_to_declare(
  p_limit         integer DEFAULT 5,
  p_retry_minutes integer DEFAULT 60
)
RETURNS TABLE (
  plugin_slug    text,
  tenant_id      uuid,
  source_slug    text,
  plugin_version text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'list_plugins_to_declare: jen služba (svc-plugin-system)' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_retry_minutes IS NULL OR p_retry_minutes < 1 THEN
    RAISE EXCEPTION 'list_plugins_to_declare: limit >= 1 a opakování >= 1 min';
  END IF;

  RETURN QUERY
  WITH kandidati AS (
    SELECT DISTINCT ON (pc.id, COALESCE(ps.user_id, ps.partner_id))
           pc.id                                   AS plugin_id,
           pc.slug                                 AS plugin_slug,
           COALESCE(ps.user_id, ps.partner_id)     AS tenant_id,
           s.source_slug,
           (SELECT v.version FROM public.plugin_versions v
             WHERE v.plugin_id = pc.id
             ORDER BY v.created_at DESC LIMIT 1)   AS plugin_version
      FROM public.agent_knowledge_sources s
      JOIN public.plugin_catalog pc ON pc.id = s.source_plugin_id
      JOIN public.partner_stories ps ON ps.id = s.story_id
     WHERE s.is_active
       AND pc.status IN ('canary', 'ga')
       AND COALESCE(ps.user_id, ps.partner_id) IS NOT NULL
     ORDER BY pc.id, COALESCE(ps.user_id, ps.partner_id), s.source_slug
  )
  SELECT k.plugin_slug, k.tenant_id, k.source_slug, k.plugin_version
    FROM kandidati k
    LEFT JOIN public.plugin_declarations d
      ON d.plugin_id = k.plugin_id AND d.tenant_id = k.tenant_id
   WHERE k.plugin_version IS NOT NULL
     AND (d.plugin_id IS NULL
          OR d.plugin_version IS DISTINCT FROM k.plugin_version
          OR (d.status = 'failed' AND d.declared_at < now() - make_interval(mins => p_retry_minutes)))
   ORDER BY d.declared_at NULLS FIRST, k.plugin_slug
   LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.list_plugins_to_declare(integer, integer) IS
  'Plugins to ignite (declare-only run → schedules): canary/ga, linked to an ACTIVE data source with a known owner (tenant), never declared / new version / failed and retry due. Service only.';

REVOKE ALL ON FUNCTION public.list_plugins_to_declare(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_plugins_to_declare(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_plugins_to_declare(integer, integer) TO service_role;
