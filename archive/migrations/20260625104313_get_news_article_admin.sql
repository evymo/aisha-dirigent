-- ============================================================================
-- Admin single-article load with canvas (3f.2b)
-- ============================================================================
-- The shared CanvasEditor needs the full canvas (canvas_data ProjectData) + draft
-- state to author a news article in GrapesJS, like a web_page. get_news_articles_admin
-- is a list (no canvas); this is the by-id admin read.
--
-- Source of truth pair: aisha/db/sql/functions/get_news_article_admin.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_news_article_admin(p_id uuid)
RETURNS TABLE (id uuid, slug text, title_key text, content_key text, excerpt_key text, image_url text, canvas_data jsonb, canvas_html text, canvas_css text, is_published boolean, tags text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
  SELECT na.id, na.slug, na.title_key, na.content_key, na.excerpt_key, na.image_url, na.canvas_data, na.canvas_html, na.canvas_css, na.is_published, na.tags
  FROM public.news_articles na WHERE na.id = p_id LIMIT 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_news_article_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_article_admin(uuid) TO authenticated;

INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
VALUES (NULL, 'get_news_article_admin.applied', 'create', 'platform', jsonb_build_object('migration', '20260625104313_get_news_article_admin', 'breaking_changes', false));
