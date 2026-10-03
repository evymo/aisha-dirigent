-- Source of truth for get_published_news_articles
-- Public listing of published news articles (anon + authenticated)

CREATE OR REPLACE FUNCTION get_published_news_articles(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  content_key text,
  excerpt_key text,
  image_url text,
  published_at timestamptz,
  sort_order integer
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
    na.published_at,
    na.sort_order
  FROM public.news_articles na
  WHERE na.is_published = true
  ORDER BY na.sort_order ASC, na.published_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION get_published_news_articles(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_published_news_articles(integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION get_published_news_articles(integer, integer) TO authenticated;
