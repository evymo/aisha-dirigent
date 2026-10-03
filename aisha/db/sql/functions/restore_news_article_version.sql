-- Function: public.restore_news_article_version
-- Description: Vrátí článek k vybrané verzi — kam, rozhoduje stav článku:
--                • zveřejněný → verze se nahraje do KONCEPTU (web se nezmění,
--                  dokud autor nezveřejní; obnova je tedy vratná);
--                • nezveřejněný → do živého stavu, ale nejdřív se uloží snímek
--                  'auto: before restore', aby šlo i obnovu vrátit.
--              Obě cesty jdou přes save_news_article_draft_admin — jeden zápis
--              hlavičky, textů i plátna. Vrací nové razítko.
--
--              Verze bez plátna (článek z importu) plátno nemění: COALESCE
--              v zápisu bere „NULL = nech" — historie takový článek nemá čím
--              přepsat a mazat plátno obnovou by bylo horší.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-09-24 (zrcadlí restore_web_page_version)

CREATE OR REPLACE FUNCTION public.restore_news_article_version(
  p_article_id uuid,
  p_version_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_v public.news_article_versions%ROWTYPE;
  v_published boolean;
  v_new timestamptz;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_v FROM public.news_article_versions v
  WHERE v.id = p_version_id AND v.article_id = p_article_id AND v.kind <> 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  SELECT a.is_published INTO v_published FROM public.news_articles a WHERE a.id = p_article_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found';
  END IF;

  IF NOT v_published THEN
    PERFORM public.create_news_article_version(p_article_id, 'auto', 'auto: before restore');
  END IF;

  v_new := public.save_news_article_draft_admin(
    p_article_id, v_v.canvas_css, v_v.canvas_data, v_v.canvas_html, NULL, v_v.fields
  );

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'NEWS_VERSION_RESTORE',
          jsonb_build_object('area', 'content', 'severity', 'warning', 'entity_type', 'news_article_version',
                             'entity_id', p_version_id::text, 'article_id', p_article_id::text,
                             'target', CASE WHEN v_published THEN 'draft' ELSE 'live' END));
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_news_article_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_news_article_version(uuid, uuid) TO authenticated;
