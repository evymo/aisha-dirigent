-- ============================================================================
-- Source of Truth: twin_catalog_source_findings
-- Popis: NÁLEZY autority zdroje v katalogu parametrů. U aditivní veličiny
--        (aggregation 'sum' / historization 'event_log') čtečka twin_param_values
--        počítá jen události zdroje, kterého katalog jmenuje. Když ten zdroj nic
--        nezapsal nebo vůbec neexistuje, veličina je NEMĚŘENO — a tahle funkce
--        řekne proč, místo aby pravidlo tiše mlčelo.
--
--   trida 'nezname'  = VADA DAT katalogu: ani `source`, ani jeho část před ':'
--                      neodpovídá žádnému zdroji (agent_knowledge_sources.source_slug
--                      nebo poslední část jeho `namespace`, kde zdroj deklaruje
--                      doménu dodavatele — 'telematics/webdispecink'), pluginu
--                      (plugin_catalog.slug) ani zdroji/dráze žádné existující
--                      reference či události. Veličina se neukáže NIKDY → brána.
--   trida 'bez_dat'  = INFORMACE: zdroj existuje, ale událost toho typu z něj
--                      zatím není (plugin neschválen, vazby nepotvrzeny…).
--
-- Vrací: [{code, source, trida}] (žádné hodnoty — jen kódy a jména zdrojů)
-- Bezpečnost: SECURITY DEFINER (čte registr zdrojů a pluginů, který je jen pro
--             správu); service_role nebo admin/staff.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_catalog_source_findings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_nalezy jsonb;
BEGIN
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'twin_catalog_source_findings: service role or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  WITH kat AS (
    SELECT d.code,
           btrim(d.source)                     AS src,
           split_part(btrim(d.source), ':', 1) AS koren,
           COALESCE(d.metadata->>'event_type',
                    CASE WHEN d.metadata->>'shape' = 'code_value'
                         THEN 'twin_parameter' END) AS event_type
      FROM public.twin_parameter_definitions d
     WHERE (lower(COALESCE(d.aggregation, '')) = 'sum'
            OR lower(COALESCE(d.historization, '')) = 'event_log')
       AND NULLIF(btrim(d.source), '') IS NOT NULL
  ),
  hodnoceni AS (
    SELECT k.code, k.src,
           (   EXISTS (SELECT 1 FROM public.agent_knowledge_sources s
                        WHERE s.source_slug = k.koren
                           OR regexp_replace(s.namespace, '^.*/', '') = k.koren)
            OR EXISTS (SELECT 1 FROM public.plugin_catalog p WHERE p.slug = k.koren)
            OR EXISTS (SELECT 1 FROM public.twin_external_refs r
                        WHERE r.source = k.koren OR starts_with(r.source, k.koren || ':'))
            OR EXISTS (SELECT 1 FROM public.twin_events e
                        WHERE e.source = k.koren OR starts_with(e.source, k.koren || ':'))
           ) AS znamy,
           EXISTS (SELECT 1 FROM public.twin_events e
                    WHERE (k.event_type IS NULL OR e.event_type = k.event_type)
                      AND (e.source = k.src OR starts_with(e.source, k.src || ':'))) AS ma_data
      FROM kat k
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code',   h.code,
           'source', h.src,
           'trida',  CASE WHEN NOT h.znamy THEN 'nezname' ELSE 'bez_dat' END)
           ORDER BY (NOT h.znamy) DESC, h.code), '[]'::jsonb)
    INTO v_nalezy
    FROM hodnoceni h
   WHERE NOT h.znamy OR NOT h.ma_data;

  RETURN v_nalezy;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_catalog_source_findings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_catalog_source_findings() TO authenticated, service_role;
