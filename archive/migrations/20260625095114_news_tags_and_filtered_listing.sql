-- ============================================================================
-- News articles: tags + dynamic filtered listing + author/tags in reads (3a)
-- ============================================================================
-- Powers a parameterized archive/blog browser over the content-node model:
-- tags on articles, a filtered listing RPC (search over translated text + tag
-- overlap + sort), a tag catalog RPC, and author/creation/tags on the detail
-- read. Dynamic, config-driven — articles are never manually placed. Generic →
-- upstream.
--
-- Source of truth pair:
--   aisha/db/sql/tables/news_articles.sql
--   aisha/db/sql/functions/{get_published_news_articles_filtered,get_news_tags,get_news_article_by_slug}.sql
-- ============================================================================

ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS idx_news_articles_tags ON public.news_articles USING gin (tags);

CREATE OR REPLACE FUNCTION public.get_published_news_articles_filtered(
  p_search text DEFAULT NULL, p_tags text[] DEFAULT NULL, p_sort text DEFAULT 'recent', p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, slug text, title_key text, content_key text, excerpt_key text, image_url text, published_at timestamptz, created_at timestamptz, sort_order integer, created_by uuid, author_display_name text, tags text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT na.id, na.slug, na.title_key, na.content_key, na.excerpt_key, na.image_url, na.published_at, na.created_at, na.sort_order, na.created_by, p.display_name, na.tags
  FROM public.news_articles na
  LEFT JOIN public.profiles p ON p.user_id = na.created_by
  WHERE na.is_published = true
    AND (p_tags IS NULL OR na.tags && p_tags)
    AND (p_search IS NULL OR p_search = '' OR EXISTS (
      SELECT 1 FROM public.translations tr WHERE tr.key IN (na.title_key, na.content_key, na.excerpt_key) AND tr.value ILIKE '%' || p_search || '%'))
  ORDER BY
    CASE WHEN p_sort = 'featured' THEN na.sort_order END ASC NULLS LAST,
    CASE WHEN p_sort = 'oldest' THEN na.published_at END ASC NULLS LAST,
    CASE WHEN p_sort = 'alpha' THEN na.title_key END ASC NULLS LAST,
    na.published_at DESC NULLS LAST
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_published_news_articles_filtered(text, text[], text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_news_articles_filtered(text, text[], text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_published_news_articles_filtered(text, text[], text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_news_tags()
RETURNS TABLE(tag text, usage_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $fn$
  SELECT t.tag, count(*)::bigint FROM public.news_articles na CROSS JOIN LATERAL unnest(na.tags) AS t(tag)
  WHERE na.is_published = true GROUP BY t.tag ORDER BY count(*) DESC, t.tag ASC;
$fn$;
REVOKE ALL ON FUNCTION public.get_news_tags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_tags() TO anon;
GRANT EXECUTE ON FUNCTION public.get_news_tags() TO authenticated;

-- RETURNS TABLE changed → DROP first.
DROP FUNCTION IF EXISTS public.get_news_article_by_slug(text);
CREATE OR REPLACE FUNCTION public.get_news_article_by_slug(p_slug text)
RETURNS TABLE(id uuid, slug text, title_key text, content_key text, excerpt_key text, image_url text, canvas_html text, canvas_css text, published_at timestamptz, created_at timestamptz, created_by uuid, author_display_name text, tags text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT na.id, na.slug, na.title_key, na.content_key, na.excerpt_key, na.image_url, na.canvas_html, na.canvas_css, na.published_at, na.created_at, na.created_by, p.display_name, na.tags
  FROM public.news_articles na LEFT JOIN public.profiles p ON p.user_id = na.created_by
  WHERE na.slug = p_slug AND na.is_published = true LIMIT 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_news_article_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_article_by_slug(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_news_article_by_slug(text) TO authenticated;

INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
VALUES (NULL, 'news_tags_and_filtered_listing.applied', 'create', 'platform', jsonb_build_object('migration', '20260625095114_news_tags_and_filtered_listing', 'breaking_changes', false));
