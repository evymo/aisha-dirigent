-- Source of truth for get_news_articles_admin
-- Admin listing of all news articles (admin/staff only).
--
-- 2026-09-24: seznam v administraci potřebuje HLEDAT a ŘADIT podle titulku, ne
-- podle i18n klíče (naměřeno: sloupec „Klíč nadpisu" a řazení podle sort_order,
-- které import naplnil chronologií 1–92, takže nahoře byl rok 2019). Proto:
--   • `p_locale` → `title`/`excerpt` = hodnota v jazyce rozhraní (NULL bez
--     překladu; ŽÁDNÝ jazyk se nedosazuje — klient locale posílá vždy);
--   • `tags`, `has_draft` (zveřejněný článek s rozdělaným konceptem),
--     `edit_stamp` (razítko pro souběh), ohnisko/přiblížení.
-- Pořadí zůstává sort_order/created_at — výchozí řazení „nejnovější nahoře,
-- koncepty první" dělá klient nad úplným seznamem (92 řádků, jeden dotaz).
-- Nový parametr + návratový typ = nový podpis → DROP bezargumentové verze.

DROP FUNCTION IF EXISTS public.get_news_articles_admin();

CREATE OR REPLACE FUNCTION public.get_news_articles_admin(p_locale text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  content_key text,
  excerpt_key text,
  image_url text,
  is_published boolean,
  published_at timestamptz,
  sort_order integer,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  title text,
  excerpt text,
  tags text[],
  has_draft boolean,
  edit_stamp timestamptz,
  image_focus_x numeric,
  image_focus_y numeric,
  image_zoom numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    na.id,
    na.slug,
    na.title_key,
    na.content_key,
    na.excerpt_key,
    na.image_url,
    na.is_published,
    na.published_at,
    na.sort_order,
    na.created_by,
    na.created_at,
    na.updated_at,
    (SELECT tr.value FROM public.translations tr
      WHERE tr.namespace = 'news' AND tr.key = na.title_key AND tr.locale = p_locale LIMIT 1),
    (SELECT tr.value FROM public.translations tr
      WHERE tr.namespace = 'news' AND tr.key = na.excerpt_key AND tr.locale = p_locale LIMIT 1),
    na.tags,
    EXISTS (SELECT 1 FROM public.news_article_versions d WHERE d.article_id = na.id AND d.kind = 'draft'),
    public.news_article_edit_stamp(na.id),
    na.image_focus_x,
    na.image_focus_y,
    na.image_zoom
  FROM public.news_articles na
  ORDER BY na.sort_order ASC, na.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_news_articles_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_articles_admin(text) TO authenticated;
