-- Source of truth for get_news_article_by_slug
-- Public single article lookup by slug (anon + authenticated)
-- 2026-09-24: + ohnisko a přiblížení titulního obrázku (výřez počítá doručení;
-- veřejná stránka je předává do adresy obrázku). Změna návratového typu → DROP je v heals.sql (CREATE OR REPLACE typ nezmění; na čisté DB DROP nemá co rušit).

CREATE OR REPLACE FUNCTION get_news_article_by_slug(
  p_slug text
)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  content_key text,
  excerpt_key text,
  image_url text,
  canvas_html text,
  canvas_css text,
  published_at timestamptz,
  image_focus_x numeric,
  image_focus_y numeric,
  image_zoom numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    na.id,
    na.slug,
    na.title_key,
    na.content_key,
    na.excerpt_key,
    na.image_url,
    na.canvas_html,
    na.canvas_css,
    na.published_at,
    na.image_focus_x,
    na.image_focus_y,
    na.image_zoom
  FROM public.news_articles na
  WHERE na.slug = p_slug
    AND na.is_published = true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION get_news_article_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_news_article_by_slug(text) TO anon;
GRANT EXECUTE ON FUNCTION get_news_article_by_slug(text) TO authenticated;
