-- Function: public.save_news_article_draft_admin
-- Description: JEDINÁ cesta, kudy jde OBSAH článku (plátno, obrázek, ohnisko,
--              přiblížení, štítky, texty) z editoru do databáze. Kam přesně,
--              rozhoduje server, ne klient:
--                • článek NENÍ zveřejněný → zapíše se rovnou do news_articles
--                  (není vidět, koncept by byl jen zdvojení);
--                • článek JE zveřejněný → zapíše se do KONCEPTU (řádek
--                  news_article_versions kind='draft'); web dál servíruje
--                  poslední zveřejněný stav, dokud nepřijde publish_news_article_admin.
--
--              Částečný zápis: NULL v p_canvas_* nebo chybějící klíč v p_fields
--              znamená „nech, co je" (v konceptu, jinak v živém stavu). Koncept
--              se při prvním zápisu ZALOŽÍ ZE ŽIVÉHO stavu, takže je vždy úplný
--              snímek, ne rozdíl.
--
--              Souběh: `p_expected_stamp` = razítko, které klient četl
--              (news_article_edit_stamp). Nesedí-li, zápis skončí 409 (PT409);
--              NULL = bez kontroly (importy, obnova verze). Vrací nové razítko.
--
-- ⛔ Naměřeno 2026-09-24: autosave plátna (5 s po změně) u zveřejněného článku
--    šel přímo do canvas_html, které čte veřejná stránka. Tahle funkce je oprava.
-- Security: SECURITY DEFINER; admin/staff NEBO service_role.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.save_news_article_draft_admin(
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

  IF NOT v_a.is_published THEN
    -- Nezveřejněný článek: živý zápis, nikdo ho nevidí.
    UPDATE public.news_articles SET
      canvas_data   = COALESCE(p_canvas_data, news_articles.canvas_data),
      canvas_html   = COALESCE(p_canvas_html, news_articles.canvas_html),
      canvas_css    = COALESCE(p_canvas_css,  news_articles.canvas_css),
      image_url     = CASE WHEN p_fields ? 'image_url' THEN NULLIF(p_fields ->> 'image_url', '') ELSE news_articles.image_url END,
      image_focus_x = COALESCE((p_fields ->> 'image_focus_x')::numeric, news_articles.image_focus_x),
      image_focus_y = COALESCE((p_fields ->> 'image_focus_y')::numeric, news_articles.image_focus_y),
      image_zoom    = COALESCE((p_fields ->> 'image_zoom')::numeric, news_articles.image_zoom),
      tags          = CASE WHEN p_fields ? 'tags'
                           THEN (SELECT COALESCE(array_agg(x.v), '{}'::text[]) FROM jsonb_array_elements_text(p_fields -> 'tags') AS x(v))
                           ELSE news_articles.tags END,
      updated_at    = now()
    WHERE news_articles.id = p_article_id
    RETURNING news_articles.updated_at INTO v_new;

    IF p_fields ? 'texts' THEN
      PERFORM public.news_article_apply_texts(p_article_id, p_fields -> 'texts');
    END IF;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'NEWS_UPDATE',
            jsonb_build_object('area', 'content', 'severity', 'info', 'entity_type', 'news_article',
                               'entity_id', p_article_id::text, 'target', 'live'));
    RETURN v_new;
  END IF;

  -- Zveřejněný článek: koncept. Založí se ze živého stavu, pak se přepíše tím, co přišlo.
  v_fields := COALESCE(v_d_fields, public.news_article_live_fields(p_article_id)) || COALESCE(p_fields, '{}'::jsonb);

  INSERT INTO public.news_article_versions (
    article_id, version_number, kind, canvas_data, canvas_html, canvas_css, fields, created_by, updated_at
  ) VALUES (
    p_article_id, 0, 'draft',
    COALESCE(p_canvas_data, v_d_canvas_data, v_a.canvas_data),
    COALESCE(p_canvas_html, v_d_canvas_html, v_a.canvas_html),
    COALESCE(p_canvas_css,  v_d_canvas_css,  v_a.canvas_css),
    v_fields, auth.uid(), now()
  )
  ON CONFLICT (article_id) WHERE kind = 'draft' DO UPDATE SET
    canvas_data = EXCLUDED.canvas_data,
    canvas_html = EXCLUDED.canvas_html,
    canvas_css  = EXCLUDED.canvas_css,
    fields      = EXCLUDED.fields,
    updated_at  = now()
  RETURNING news_article_versions.updated_at INTO v_new;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'NEWS_DRAFT_SAVE',
          jsonb_build_object('area', 'content', 'severity', 'info', 'entity_type', 'news_article',
                             'entity_id', p_article_id::text, 'target', 'draft'));
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.save_news_article_draft_admin(uuid, text, jsonb, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_news_article_draft_admin(uuid, text, jsonb, text, timestamptz, jsonb) TO authenticated, service_role;
