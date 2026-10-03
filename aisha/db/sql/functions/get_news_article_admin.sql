-- Source of truth for get_news_article_admin
-- Admin single-article load by id INCLUDING the canvas (canvas_data ProjectData
-- + html/css) and draft state — the editor needs the full canvas to hydrate
-- GrapesJS and must see unpublished drafts. Admin only.
--
-- 2026-09-24: + štítky, ohnisko/přiblížení, `edit_stamp` (razítko pro souběh) a
-- `draft` — KONCEPT zveřejněného článku jako JSON {canvas_data, canvas_html,
-- canvas_css, fields, updated_at}, nebo NULL. Editor hydratuje plátno z konceptu,
-- je-li; dialog hlavičky čte `draft.fields` (obrázek, štítky, texty).
-- Změna návratového typu = DROP v heals.sql (CREATE OR REPLACE typ nezmění; čistá DB ho nepotřebuje).

CREATE OR REPLACE FUNCTION public.get_news_article_admin(p_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  content_key text,
  excerpt_key text,
  image_url text,
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  is_published boolean,
  tags text[],
  image_focus_x numeric,
  image_focus_y numeric,
  image_zoom numeric,
  updated_at timestamptz,
  edit_stamp timestamptz,
  draft jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
  SELECT na.id, na.slug, na.title_key, na.content_key, na.excerpt_key, na.image_url,
         na.canvas_data, na.canvas_html, na.canvas_css, na.is_published,
         na.tags, na.image_focus_x, na.image_focus_y, na.image_zoom, na.updated_at,
         public.news_article_edit_stamp(na.id),
         (SELECT jsonb_build_object(
                   'canvas_data', d.canvas_data,
                   'canvas_html', d.canvas_html,
                   'canvas_css',  d.canvas_css,
                   'fields',      d.fields,
                   'updated_at',  d.updated_at)
            FROM public.news_article_versions d
           WHERE d.article_id = na.id AND d.kind = 'draft')
  FROM public.news_articles na WHERE na.id = p_id LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_news_article_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_article_admin(uuid) TO authenticated;
