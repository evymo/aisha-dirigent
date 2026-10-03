-- Function: public.news_article_apply_texts
-- Description: Zapíše texty článku ({locale: {title, excerpt, content}}) do
--              `translations` pod klíče článku — přes `upsert_translations`,
--              aby platila TÁŽ autorizace (admin bez omezení, staff jen obsahové
--              namespacy) a týž zápis jako z administrace. Prázdný text se
--              přeskočí, ne smaže (stejně jako to dělal klient).
-- Security: SECURITY DEFINER; autorizaci nese upsert_translations (auth.uid()
--           je pořád volající). Volá se z publish/restore/draft RPC novinek.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.news_article_apply_texts(p_article_id uuid, p_texts jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_a record;
  v_pole jsonb;
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_texts IS NULL OR jsonb_typeof(p_texts) <> 'object' THEN
    RETURN;
  END IF;

  SELECT title_key, excerpt_key, content_key INTO v_a
  FROM public.news_articles WHERE id = p_article_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'key', k.klic, 'locale', l.locale, 'namespace', 'news', 'value', l.texty ->> k.pole))
    INTO v_pole
  FROM jsonb_each(p_texts) AS l(locale, texty)
  CROSS JOIN LATERAL (VALUES ('title', v_a.title_key), ('excerpt', v_a.excerpt_key), ('content', v_a.content_key)) AS k(pole, klic)
  WHERE k.klic IS NOT NULL
    AND jsonb_typeof(l.texty) = 'object'
    AND COALESCE(l.texty ->> k.pole, '') <> '';

  IF v_pole IS NOT NULL AND jsonb_array_length(v_pole) > 0 THEN
    PERFORM public.upsert_translations(v_pole);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.news_article_apply_texts(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.news_article_apply_texts(uuid, jsonb) TO authenticated, service_role;
