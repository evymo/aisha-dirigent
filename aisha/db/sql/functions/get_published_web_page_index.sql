-- get_published_web_page_index — seznam publikovaných stránek pro daný hostname
-- plus razítko poslední změny.
--
-- PROČ EXISTUJE (2026-08-30). Veřejný web je dnes prázdná SPA skořápka:
-- návštěvník stáhne 3,5 MB JS, teprve pak se aplikace zeptá na obsah stránky.
-- Generátor statických stránek to obrací — HTML publikované stránky vyrobí
-- dopředu, takže první vykreslení JE hotový design. K tomu potřebuje dvě věci,
-- které dosud žádná veřejná RPC nedávala:
--
--   1) SEZNAM slugů, které má vygenerovat. `get_web_page_by_slug` umí jednu
--      stránku podle jména — generátor ale jména předem nezná a hádat je
--      (natvrdo vepsaný výčet) by znamenalo, že nová stránka z editoru se
--      na webu nikdy neobjeví.
--   2) RAZÍTKO `max(updated_at)` jako levnou kontrolu čerstvosti. Generátor
--      se jím ptá „změnilo se něco?" místo aby tahal obsah všech stránek;
--      je to záchytná síť pro případ, že se ztratí push signál z editoru.
--
-- Přístupová třída je TÁŽ jako u get_web_page_by_slug: vrací jen slugy stránek,
-- které jsou UŽ TEĎ veřejně čitelné. Nepřidává tedy žádnou novou expozici —
-- kdo si může vyžádat obsah, může si vyžádat i seznam. Proto anon, a proto
-- žádná autorizační stráž nad rámec filtru `status = 'published'`.
--
-- Na čtecí cestě se ZÁMĚRNĚ neaudituje: audit per request by z levné kontroly
-- čerstvosti udělal zapisující transakci každých pár sekund.
CREATE OR REPLACE FUNCTION public.get_published_web_page_index(p_hostname text DEFAULT NULL)
RETURNS TABLE (
  slug text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  -- Táž logika jako get_web_page_by_slug (sdílený resolver), aby generátor
  -- dostal PRÁVĚ TY stránky, které týž hostname pak servíruje.
  v_brand_id := public.resolve_brand_for_hostname(p_hostname);

  -- DISTINCT ON (slug) + týž ORDER BY jako v get_web_page_by_slug: když
  -- existuje značková i globální varianta téhož slugu, vyhrává značková.
  -- Bez toho by generátor vyrobil stránku z jednoho řádku a runtime by
  -- servíroval druhý — dvě pravdy o téže adrese.
  RETURN QUERY
  SELECT DISTINCT ON (wp.slug)
    wp.slug,
    wp.updated_at
  FROM web_pages wp
  WHERE wp.status = 'published'
    AND wp.is_active = true
    -- ⛔ ÚTRŽEK NENÍ STRÁNKA. Hlavička a patička žijí v `web_pages` se
    -- `page_settings->>'role' = 'partial'`, aby je šlo editovat týmž editorem.
    -- Bez tohohle filtru by se servírovaly jako samostatné adresy (/nav/)
    -- a generátor by jim vyráběl vlastní soubory — tedy hlavička bez stránky.
    AND coalesce(wp.page_settings->>'role', '') <> 'partial'
    AND (
      wp.branding_profile_id = v_brand_id
      OR wp.branding_profile_id IS NULL
    )
  ORDER BY wp.slug, (wp.branding_profile_id IS NOT NULL) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_published_web_page_index(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_web_page_index(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_published_web_page_index(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_web_page_index(text) TO service_role;
