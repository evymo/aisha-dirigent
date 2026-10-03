-- Source of truth for get_news_tags
-- The distinct tags in use across published articles (+ usage count) — feeds the
-- archive/blog browser's tag filter, the same way get_archive_filter_options
-- feeds the archive browser. Dynamic; no hardcoded taxonomy.

CREATE OR REPLACE FUNCTION public.get_news_tags()
RETURNS TABLE(tag text, usage_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT t.tag, count(*)::bigint AS usage_count
  FROM public.news_articles na
  CROSS JOIN LATERAL unnest(na.tags) AS t(tag)
  WHERE na.is_published = true
  GROUP BY t.tag
  ORDER BY count(*) DESC, t.tag ASC;
$$;

REVOKE ALL ON FUNCTION public.get_news_tags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_tags() TO anon;
GRANT EXECUTE ON FUNCTION public.get_news_tags() TO authenticated;
