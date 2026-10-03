-- Function: public.discard_news_article_draft_admin
-- Description: Zahodí koncept zveřejněného článku — web nic nepozná, editor se
--              vrátí k poslednímu zveřejněnému stavu. Vrací razítko po zahození
--              (= updated_at článku). Bez konceptu je to no-op.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.discard_news_article_draft_admin(p_article_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated timestamptz;
  v_smazano integer;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT a.updated_at INTO v_updated FROM public.news_articles a WHERE a.id = p_article_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found';
  END IF;

  DELETE FROM public.news_article_versions d
  WHERE d.article_id = p_article_id AND d.kind = 'draft';
  GET DIAGNOSTICS v_smazano = ROW_COUNT;

  IF v_smazano > 0 THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'NEWS_DRAFT_DISCARD',
            jsonb_build_object('area', 'content', 'severity', 'info', 'entity_type', 'news_article',
                               'entity_id', p_article_id::text));
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_news_article_draft_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_news_article_draft_admin(uuid) TO authenticated;
