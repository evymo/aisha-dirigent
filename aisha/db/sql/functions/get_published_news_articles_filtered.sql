-- Source of truth for get_published_news_articles_filtered
-- Dynamic, parameterized public listing of published articles — the backend for
-- a GrapesJS archive/blog browser block (config = filter params; no manual
-- placement). Mirrors get_archive_documents but over the content-node model.
-- Search is over the TRANSLATED text (articles use i18n keys, so it joins
-- translations.value), not the raw key. Returns author + tags for the cards.
--
-- ⛔ CO HLEDÁNÍ MĚŘITELNĚ NEUMĚLO (naměřeno 2026-09-21 na instanci, 226 článků):
--  1. Hledalo v SUROVÉM HTML. Všech 226 těl obsahuje `<p`, 175 nese odkaz,
--     120 `<img>` — dotaz „img" nebo „href" vracel celou knihovnu, a naopak
--     fráze rozdělená značkou (`<strong>Dzogchen</strong> je`) se nenašla.
--     Řeší `text_z_html()` (vlastní SoT, IMMUTABLE).
--  2. NEHLEDALO V PLÁTNĚ. Článek napsaný v editoru (GrapesJS) má text
--     v `canvas_html`, ne v `content_key` — takový článek byl dohledatelný
--     jedině přes titulek. Každý nový článek by tím z knihovny zmizel.
--  3. Nehledalo ve `slug` ani ve štítcích, přitom obojí je text, který autor
--     volí jako popis obsahu.
--
-- ⛔ ABECEDNÍ ŘAZENÍ ŘADILO PODLE KLÍČE (opraveno 2026-09-21).
--  `p_sort = 'alpha'` řadilo podle `na.title_key`, tedy podle i18n KLÍČE
--  (`news.article.42.title`), ne podle titulku — ten žije v `translations`
--  N-krát, pro každý jazyk jeden. „Abecedně (A–Z)" tedy vracelo pořadí podle
--  času vzniku klíče. Řeší to `p_locale`: řadí se podle hodnoty titulku v tom
--  jazyce, řádky bez titulku v něm jdou NULLS LAST.
--
--  BEZ `p_locale` se abecedně řadit NEMÁ O CO OPŘÍT a ŽÁDNÝ jazyk se nedosazuje
--  (dosazení je přesně ten druh tichého rozhodnutí, který se v tomhle repu
--  nedělá): výraz je pak NULL pro všechny řádky a pořadí zůstane podle data,
--  což je dokumentovaný náhradní klíč `published_at DESC`. Klient proto locale
--  posílá VŽDY a hlídá to brána.
--
-- 2026-09-24: + ohnisko a přiblížení titulního obrázku (karty si výřez berou
-- z doručení). Změna návratového typu = DROP 6argumentové verze v heals.sql (čistá DB ho nepotřebuje).

-- Nový parametr na KONCI = nový podpis. `CREATE OR REPLACE` by starou 5-argumentovou
-- variantu nenahradil, ale vytvořil PŘETÍŽENÍ, a PostgREST by pak volání s pojmenovanými
-- argumenty odmítl jako nejednoznačné. DROP je proto součást opravy, ne úklid.
DROP FUNCTION IF EXISTS public.get_published_news_articles_filtered(text, text[], text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_published_news_articles_filtered(
  p_search text    DEFAULT NULL,
  p_tags   text[]  DEFAULT NULL,
  p_sort   text    DEFAULT 'recent',
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_locale text    DEFAULT NULL
)
RETURNS TABLE(
  id uuid, slug text, title_key text, content_key text, excerpt_key text,
  image_url text, published_at timestamptz, created_at timestamptz, sort_order integer,
  created_by uuid, author_display_name text, tags text[],
  image_focus_x numeric, image_focus_y numeric, image_zoom numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT na.id, na.slug, na.title_key, na.content_key, na.excerpt_key,
         na.image_url, na.published_at, na.created_at, na.sort_order,
         na.created_by, p.display_name, na.tags,
         na.image_focus_x, na.image_focus_y, na.image_zoom
  FROM public.news_articles na
  LEFT JOIN public.profiles p ON p.user_id = na.created_by
  WHERE na.is_published = true
    AND (p_tags IS NULL OR na.tags && p_tags)
    AND (p_search IS NULL OR p_search = ''
         -- Přeložené texty (titulek/perex/tělo) ve VŠECH jazycích: dvojjazyčná
         -- knihovna má najít článek i na dotaz v druhém jazyce.
         OR EXISTS (
           SELECT 1 FROM public.translations tr
           WHERE tr.key IN (na.title_key, na.content_key, na.excerpt_key)
             AND public.text_z_html(tr.value) ILIKE '%' || p_search || '%')
         -- Tělo napsané v editoru (plátno). Bez tohohle řádku není nový článek
         -- dohledatelný podle obsahu vůbec.
         OR (na.canvas_html IS NOT NULL
             AND public.text_z_html(na.canvas_html) ILIKE '%' || p_search || '%')
         -- Slug a štítky: autorem zvolený popis obsahu.
         OR na.slug ILIKE '%' || p_search || '%'
         OR EXISTS (
           SELECT 1 FROM unnest(na.tags) AS stitek
           WHERE stitek ILIKE '%' || p_search || '%'))
  ORDER BY
    CASE WHEN p_sort = 'featured' THEN na.sort_order   END ASC NULLS LAST,
    CASE WHEN p_sort = 'oldest'   THEN na.published_at END ASC NULLS LAST,
    CASE WHEN p_sort = 'alpha' THEN (
           SELECT tr.value FROM public.translations tr
            WHERE tr.key = na.title_key AND tr.locale = p_locale
            LIMIT 1)
    END ASC NULLS LAST,
    na.published_at DESC NULLS LAST
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_published_news_articles_filtered(text, text[], text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_news_articles_filtered(text, text[], text, integer, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_published_news_articles_filtered(text, text[], text, integer, integer, text) TO authenticated;
