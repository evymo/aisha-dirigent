-- Function: public.create_news_article_version
-- Description: Snímek ŽIVÉHO stavu článku (plátno + hlavička + texty) do historie.
--              Druhy: 'manual' (ruční uložení), 'auto' (před obnovou verze),
--              'published' (každé zveřejnění). Koncept ('draft') se sem NEZAPISUJE —
--              ten má vlastní cestu (save_news_article_draft_admin).
--
--              Retence: 'manual' + 'auto' se drží posledních 30 na článek,
--              'published' se nemaže nikdy — je to to, co kdy viděl web.
--
-- Security: SECURITY DEFINER; admin/staff NEBO service_role (seed zveřejňuje).
-- Created: 2026-09-24 (zrcadlí create_web_page_version)

CREATE OR REPLACE FUNCTION public.create_news_article_version(
  p_article_id uuid,
  p_kind text DEFAULT 'manual',
  p_label text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_a public.news_articles%ROWTYPE;
  v_next integer;
  v_id uuid;
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_kind NOT IN ('manual', 'auto', 'published') THEN
    RAISE EXCEPTION 'Invalid version kind: %', p_kind;
  END IF;

  SELECT * INTO v_a FROM public.news_articles WHERE id = p_article_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found';
  END IF;

  SELECT COALESCE(MAX(v.version_number), 0) + 1
    INTO v_next
  FROM public.news_article_versions v
  WHERE v.article_id = p_article_id AND v.kind <> 'draft';

  INSERT INTO public.news_article_versions (
    article_id, version_number, kind, canvas_data, canvas_html, canvas_css, fields, label, created_by
  ) VALUES (
    p_article_id, v_next, p_kind, v_a.canvas_data, v_a.canvas_html, v_a.canvas_css,
    public.news_article_live_fields(p_article_id), p_label, auth.uid()
  )
  RETURNING id INTO v_id;

  -- Retence: ruční a automatické snímky jen posledních 30; zveřejněné zůstávají.
  DELETE FROM public.news_article_versions v
  WHERE v.article_id = p_article_id
    AND v.kind IN ('manual', 'auto')
    AND v.id NOT IN (
      SELECT k.id FROM public.news_article_versions k
      WHERE k.article_id = p_article_id AND k.kind IN ('manual', 'auto')
      ORDER BY k.version_number DESC
      LIMIT 30
    );

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'NEWS_VERSION_CREATE',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'news_article_version',
      'entity_id', v_id::text,
      'article_id', p_article_id::text,
      'kind', p_kind,
      'version_number', v_next
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_news_article_version(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_news_article_version(uuid, text, text) TO authenticated, service_role;
