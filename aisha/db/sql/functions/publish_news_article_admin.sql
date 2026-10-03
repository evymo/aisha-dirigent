-- Function: public.publish_news_article_admin
-- Description: Zveřejní článek: koncept (je-li) + to, co přišlo v parametrech,
--              se přelije do news_articles, article dostane is_published = true
--              (published_at se nastaví jen poprvé — opakované zveřejnění
--              nemění pořadí na webu), koncept se smaže a do historie jde snímek
--              kind = 'published'. Vrací nové razítko (news_article_edit_stamp).
--
--              Parametry plátna/hlavičky jsou pro editor, který zveřejňuje
--              rovnou z rozpracovaného stavu („Zveřejnit"); NULL = vezmi koncept,
--              a není-li, živý stav.
-- Security: SECURITY DEFINER; admin/staff NEBO service_role (seed).
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.publish_news_article_admin(
  p_article_id uuid,
  p_canvas_css text DEFAULT NULL,
  p_canvas_data jsonb DEFAULT NULL,
  p_canvas_html text DEFAULT NULL,
  p_expected_stamp timestamptz DEFAULT NULL,
  p_fields jsonb DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_a public.news_articles%ROWTYPE;
  v_d_canvas_data jsonb;
  v_d_canvas_html text;
  v_d_canvas_css text;
  v_d_fields jsonb;
  v_d_updated timestamptz;
  v_stamp timestamptz;
  v_fields jsonb;
  v_new timestamptz;
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  PERFORM public.news_article_check_fields(p_fields);

  SELECT * INTO v_a FROM public.news_articles WHERE id = p_article_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found';
  END IF;

  SELECT d.canvas_data, d.canvas_html, d.canvas_css, d.fields, d.updated_at
    INTO v_d_canvas_data, v_d_canvas_html, v_d_canvas_css, v_d_fields, v_d_updated
  FROM public.news_article_versions d
  WHERE d.article_id = p_article_id AND d.kind = 'draft'
  FOR UPDATE;

  v_stamp := GREATEST(v_a.updated_at, COALESCE(v_d_updated, v_a.updated_at));
  IF p_expected_stamp IS NOT NULL AND v_stamp <> p_expected_stamp THEN
    RAISE EXCEPTION 'Article changed since it was loaded (stamp % vs expected %)', v_stamp, p_expected_stamp
      USING ERRCODE = 'PT409';
  END IF;

  v_fields := COALESCE(v_d_fields, '{}'::jsonb) || COALESCE(p_fields, '{}'::jsonb);

  UPDATE public.news_articles SET
    canvas_data   = COALESCE(p_canvas_data, v_d_canvas_data, news_articles.canvas_data),
    canvas_html   = COALESCE(p_canvas_html, v_d_canvas_html, news_articles.canvas_html),
    canvas_css    = COALESCE(p_canvas_css,  v_d_canvas_css,  news_articles.canvas_css),
    image_url     = CASE WHEN v_fields ? 'image_url' THEN NULLIF(v_fields ->> 'image_url', '') ELSE news_articles.image_url END,
    image_focus_x = COALESCE((v_fields ->> 'image_focus_x')::numeric, news_articles.image_focus_x),
    image_focus_y = COALESCE((v_fields ->> 'image_focus_y')::numeric, news_articles.image_focus_y),
    image_zoom    = COALESCE((v_fields ->> 'image_zoom')::numeric, news_articles.image_zoom),
    tags          = CASE WHEN v_fields ? 'tags'
                         THEN (SELECT COALESCE(array_agg(x.v), '{}'::text[]) FROM jsonb_array_elements_text(v_fields -> 'tags') AS x(v))
                         ELSE news_articles.tags END,
    is_published  = true,
    published_at  = COALESCE(news_articles.published_at, now()),
    updated_at    = now()
  WHERE news_articles.id = p_article_id
  RETURNING news_articles.updated_at INTO v_new;

  IF v_fields ? 'texts' THEN
    PERFORM public.news_article_apply_texts(p_article_id, v_fields -> 'texts');
  END IF;

  DELETE FROM public.news_article_versions d
  WHERE d.article_id = p_article_id AND d.kind = 'draft';

  PERFORM public.create_news_article_version(p_article_id, 'published', NULL);

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'NEWS_PUBLISH',
          jsonb_build_object('area', 'content', 'severity', 'info', 'entity_type', 'news_article',
                             'entity_id', p_article_id::text, 'had_draft', v_d_updated IS NOT NULL));
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_news_article_admin(uuid, text, jsonb, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_news_article_admin(uuid, text, jsonb, text, timestamptz, jsonb) TO authenticated, service_role;
