-- Source of truth for update_news_article_admin
-- Admin updates the STRUCTURAL fields of a news article (slug, pořadí, zveřejnění,
-- klíče textů) with audit logging.
--
-- 2026-09-24: OBSAH (plátno, obrázek, ohnisko, přiblížení, štítky, texty) jde přes
-- save_news_article_draft_admin — ta rozhodne, zda do konceptu (zveřejněný článek),
-- nebo živě. `p_image_url` tu zůstává pro volající z doby před 2026-09-24 a píše
-- ŽIVĚ; nový klient obrázek posílá v `p_fields` konceptu.
--   • p_is_published = true u nezveřejněného článku = ZVEŘEJNĚNÍ → jde přes
--     publish_news_article_admin (přelije koncept, udělá snímek 'published').
--   • p_is_published = false u zveřejněného článku = stažení z webu; rozdělaný
--     koncept se přitom přelije do (teď neviditelného) živého stavu, aby se
--     práce neztratila, a koncept zanikne.
--   • p_expected_stamp = razítko z načtení (news_article_edit_stamp); nesedí-li,
--     zápis skončí 409 (PT409) místo tichého přepsání cizí práce.
-- Vrací nové razítko. Nový parametr + návratový typ = nový podpis, proto DROP.

DROP FUNCTION IF EXISTS public.update_news_article_admin(uuid, text, text, text, boolean, timestamptz, text, integer, text);

CREATE OR REPLACE FUNCTION public.update_news_article_admin(
  p_id uuid,
  p_content_key text DEFAULT NULL,
  p_excerpt_key text DEFAULT NULL,
  p_expected_stamp timestamptz DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_is_published boolean DEFAULT NULL,
  p_published_at timestamptz DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_title_key text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_published boolean;
  v_stamp timestamptz;
  v_d public.news_article_versions%ROWTYPE;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT a.is_published INTO v_published FROM public.news_articles a WHERE a.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found';
  END IF;

  v_stamp := public.news_article_edit_stamp(p_id);
  IF p_expected_stamp IS NOT NULL AND v_stamp <> p_expected_stamp THEN
    RAISE EXCEPTION 'Article changed since it was loaded (stamp % vs expected %)', v_stamp, p_expected_stamp
      USING ERRCODE = 'PT409';
  END IF;

  IF p_is_published = true AND NOT v_published THEN
    PERFORM public.publish_news_article_admin(p_id, NULL, NULL, NULL, NULL, NULL);
  END IF;

  UPDATE public.news_articles SET
    content_key  = COALESCE(p_content_key, content_key),
    excerpt_key  = COALESCE(p_excerpt_key, excerpt_key),
    image_url    = COALESCE(p_image_url, image_url),
    is_published = COALESCE(p_is_published, is_published),
    published_at = CASE
                     WHEN p_is_published = true AND published_at IS NULL
                       THEN COALESCE(p_published_at, now())
                     WHEN p_published_at IS NOT NULL
                       THEN p_published_at
                     ELSE published_at
                   END,
    slug         = COALESCE(p_slug, slug),
    sort_order   = COALESCE(p_sort_order, sort_order),
    title_key    = COALESCE(p_title_key, title_key),
    updated_at   = now()
  WHERE id = p_id;

  -- Stažení z webu: rozdělaný koncept se přelije do živého (teď neviditelného) stavu.
  IF p_is_published = false AND v_published THEN
    SELECT * INTO v_d FROM public.news_article_versions d
    WHERE d.article_id = p_id AND d.kind = 'draft' FOR UPDATE;
    IF FOUND THEN
      DELETE FROM public.news_article_versions d WHERE d.id = v_d.id;
      PERFORM public.save_news_article_draft_admin(p_id, v_d.canvas_css, v_d.canvas_data, v_d.canvas_html, NULL, v_d.fields);
    END IF;
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'NEWS_UPDATE',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'news_article',
      'entity_id', p_id
    )
  );

  RETURN public.news_article_edit_stamp(p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_news_article_admin(uuid, text, text, timestamptz, text, boolean, timestamptz, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_news_article_admin(uuid, text, text, timestamptz, text, boolean, timestamptz, text, integer, text) TO authenticated;
