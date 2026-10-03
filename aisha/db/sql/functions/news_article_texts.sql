-- Function: public.news_article_texts
-- Description: Texty článku (titulek/perex/tělo) po jazycích jako jeden JSON —
--              {"cs": {"title": "…", "excerpt": "…"}, "en": {…}}.
--              Texty žijí v `translations` pod třemi klíči článku; tohle je
--              jediné místo, kde se skládají do snímku (verze, koncept).
-- Security: SECURITY INVOKER — `translations` smí číst i anon; pomocník
--           nedává víc, než tabulka sama. Volají ho DEFINER RPC novinek.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.news_article_texts(p_article_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(s.locale, s.texty), '{}'::jsonb)
  FROM (
    SELECT tr.locale,
           jsonb_strip_nulls(jsonb_build_object(
             'title',   MAX(CASE WHEN tr.key = a.title_key   THEN tr.value END),
             'excerpt', MAX(CASE WHEN tr.key = a.excerpt_key THEN tr.value END),
             'content', MAX(CASE WHEN tr.key = a.content_key THEN tr.value END)
           )) AS texty
    FROM public.news_articles a
    JOIN public.translations tr
      ON tr.namespace = 'news'
     AND tr.key IN (a.title_key, a.excerpt_key, a.content_key)
    WHERE a.id = p_article_id
    GROUP BY tr.locale
  ) s;
$$;

REVOKE ALL ON FUNCTION public.news_article_texts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.news_article_texts(uuid) TO authenticated, service_role;
