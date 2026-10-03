-- Source of truth for create_news_article_admin
-- Admin creates a new news article with audit logging.
-- 2026-09-24: + štítky, ohnisko a přiblížení titulního obrázku (nový podpis → DROP).
-- Texty a plátno se zapisují až po založení přes save_news_article_draft_admin
-- (článek vzniká nezveřejněný, takže jdou rovnou do živého stavu).

DROP FUNCTION IF EXISTS public.create_news_article_admin(text, text, text, boolean, timestamptz, text, integer, text);

CREATE OR REPLACE FUNCTION public.create_news_article_admin(
  p_content_key text,
  p_excerpt_key text DEFAULT NULL,
  p_image_focus_x numeric DEFAULT 0.5,
  p_image_focus_y numeric DEFAULT 0.5,
  p_image_url text DEFAULT NULL,
  p_image_zoom numeric DEFAULT 1,
  p_is_published boolean DEFAULT false,
  p_published_at timestamptz DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_sort_order integer DEFAULT 0,
  p_tags text[] DEFAULT '{}'::text[],
  p_title_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Generate slug from title_key if not provided
  v_slug := COALESCE(p_slug, 'article-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  INSERT INTO public.news_articles (
    content_key,
    created_by,
    excerpt_key,
    image_focus_x,
    image_focus_y,
    image_url,
    image_zoom,
    is_published,
    published_at,
    slug,
    sort_order,
    tags,
    title_key
  ) VALUES (
    p_content_key,
    auth.uid(),
    p_excerpt_key,
    COALESCE(p_image_focus_x, 0.5),
    COALESCE(p_image_focus_y, 0.5),
    p_image_url,
    COALESCE(p_image_zoom, 1),
    p_is_published,
    CASE WHEN p_is_published THEN COALESCE(p_published_at, now()) ELSE p_published_at END,
    v_slug,
    p_sort_order,
    COALESCE(p_tags, '{}'::text[]),
    COALESCE(p_title_key, 'news.' || v_slug || '.title')
  )
  RETURNING news_articles.id INTO v_id;

  -- Zveřejnění rovnou při založení = první verze do historie.
  IF p_is_published THEN
    PERFORM public.create_news_article_version(v_id, 'published', NULL);
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'NEWS_CREATE',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'news_article',
      'entity_id', v_id
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_news_article_admin(text, text, numeric, numeric, text, numeric, boolean, timestamptz, text, integer, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_news_article_admin(text, text, numeric, numeric, text, numeric, boolean, timestamptz, text, integer, text[], text) TO authenticated;
