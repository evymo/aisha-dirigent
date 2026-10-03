-- ============================================================================
-- News articles become GrapesJS content nodes (2b)
-- ============================================================================
-- Admin "news" were title_key/content_key i18n only, while web_pages were
-- GrapesJS canvases. This unifies them: news_articles gains canvas_data/html/css
-- so admins author articles in the SAME editor as pages, the article hosts
-- runtime blocks (incl. discussion-thread), and news/pages/KB share one content-
-- node model. Generic → flows upstream.
--
-- Source of truth pair:
--   aisha/db/sql/tables/news_articles.sql
--   aisha/db/sql/functions/update_news_article_canvas_admin.sql
-- ============================================================================

ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS canvas_data jsonb;
ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS canvas_html text;
ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS canvas_css  text;
COMMENT ON COLUMN public.news_articles.canvas_data IS 'GrapesJS ProjectData JSON (full editor state) — same model as web_pages.';
COMMENT ON COLUMN public.news_articles.canvas_html IS 'Rendered HTML from GrapesJS (carries data-runtime-block placeholders).';
COMMENT ON COLUMN public.news_articles.canvas_css IS 'Scoped CSS from GrapesJS.';

CREATE OR REPLACE FUNCTION public.update_news_article_canvas_admin(
  p_id uuid, p_canvas_data jsonb DEFAULT NULL, p_canvas_html text DEFAULT NULL, p_canvas_css text DEFAULT NULL, p_publish boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.news_articles SET
    canvas_data  = COALESCE(p_canvas_data, news_articles.canvas_data),
    canvas_html  = COALESCE(p_canvas_html, news_articles.canvas_html),
    canvas_css   = COALESCE(p_canvas_css,  news_articles.canvas_css),
    is_published = CASE WHEN p_publish THEN true ELSE news_articles.is_published END,
    published_at = CASE WHEN p_publish AND news_articles.published_at IS NULL THEN now() ELSE news_articles.published_at END,
    updated_at   = now()
  WHERE news_articles.id = p_id;
  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type, p_area := 'content'::public.journal_area,
    p_details := NULL, p_entity_id := p_id::text, p_entity_type := 'news_article',
    p_new_values := jsonb_build_object('publish', p_publish), p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := CASE WHEN p_publish THEN 'Published news article canvas' ELSE 'Saved news article canvas' END,
    p_tags := ARRAY['admin','content','news_article','canvas'], p_user_id := auth.uid()
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean) TO authenticated;

INSERT INTO public.audit_journal (user_id, action, action_type, area, metadata)
VALUES (NULL, 'news_article_canvas.applied', 'create', 'platform',
  jsonb_build_object('migration', '20260625092921_news_article_canvas', 'breaking_changes', false));
