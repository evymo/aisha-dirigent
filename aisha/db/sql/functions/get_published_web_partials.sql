-- Sdílené útržky (hlavička, patička) publikovaného webu.
--
-- ⛔ PROČ VLASTNÍ FUNKCE A NE SLOUPEC V `get_web_page_by_slug`. Útržek NENÍ
-- vlastnost stránky — je to obsah sdílený VŠEMI stránkami. Vracet ho u každé
-- stránky zvlášť by znamenalo přenášet tutéž hlavičku pokaždé, tedy přesně tu
-- duplikaci, kterou útržky ruší (naměřeno 2026-08-30: hlavička byla zkopírovaná
-- v 10 plátnech a na `news` se už rozešla, aniž to kdo chtěl).
--
-- Útržek je `web_pages` se `page_settings->>'role' = 'partial'`: týž editor,
-- totéž plátno, tytéž i18n klíče — jen se neservíruje jako samostatná stránka.
--
-- ⛔ ROZLIŠENÍ ZNAČKY JE POVINNÉ. Táž logika jako v `get_published_web_page_index`
-- a `get_web_page_by_slug`: bez ní by vícemznačková instance dostala do hlavičky
-- cizí navigaci — tedy tiše špatný web, ne chybu.
CREATE OR REPLACE FUNCTION public.get_published_web_partials(p_hostname text DEFAULT NULL)
RETURNS TABLE (
  ref text,
  canvas_html text,
  canvas_css text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  -- Značka podle hostname: sdílený resolve_brand_for_hostname — mapování je
  -- autorita, status profilu ne (viz komentář v té funkci, 2026-09-19).
  v_brand_id := public.resolve_brand_for_hostname(p_hostname);

  -- DISTINCT ON (slug) + týž ORDER BY jako u stránek: existuje-li značková
  -- i globální varianta téhož útržku, vyhrává značková. Jinak by generátor
  -- vzal jeden řádek a prohlížeč druhý — dvě pravdy o téže hlavičce.
  RETURN QUERY
  SELECT DISTINCT ON (wp.slug)
    wp.slug AS ref,
    wp.canvas_html,
    wp.canvas_css
  FROM web_pages wp
  WHERE wp.status = 'published'
    AND wp.is_active = true
    AND wp.page_settings->>'role' = 'partial'
    AND (
      wp.branding_profile_id = v_brand_id
      OR wp.branding_profile_id IS NULL
    )
  ORDER BY wp.slug, (wp.branding_profile_id IS NOT NULL) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_published_web_partials(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_web_partials(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_published_web_partials(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_web_partials(text) TO service_role;
