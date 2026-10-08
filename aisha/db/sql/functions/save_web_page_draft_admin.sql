-- Function: public.save_web_page_draft_admin
-- Description: Cesta, kudy jde OBSAH stránky (plátno + nastavení stránky)
--              z editoru do databáze. Kam přesně, rozhoduje server, ne klient:
--                • stránka NENÍ zveřejněná → zapíše se rovnou do web_pages
--                  (není vidět, koncept by byl jen zdvojení);
--                • stránka JE zveřejněná → zapíše se do KONCEPTU (řádek
--                  web_page_versions kind='draft'); web dál servíruje poslední
--                  zveřejněný stav, dokud nepřijde publish_web_page_admin.
--              Platí i pro sdílené útržky (hlavička, patička) — jsou to stránky.
--
--              Částečný zápis: NULL v p_* znamená „nech, co je" (v konceptu,
--              jinak v živém stavu). Koncept se při prvním zápisu ZALOŽÍ ZE
--              ŽIVÉHO stavu, takže je vždy úplný snímek, ne rozdíl.
--
--              Souběh: `p_expected_stamp` = razítko, které klient četl
--              (web_page_edit_stamp). Nesedí-li, zápis skončí 409 (PT409);
--              NULL = bez kontroly (obnova verze, šablona). Vrací nové razítko.
--
-- ⛔ Naměřeno 2026-10-02 (na instanci): autosave plátna (5 s po změně) u zveřejněné
--    stránky šel přímo do canvas_html, které čte veřejný web. Tahle funkce je oprava.
-- Security: SECURITY DEFINER; admin/staff NEBO service_role.
-- Created: 2026-10-02 (zrcadlí save_news_article_draft_admin)

CREATE OR REPLACE FUNCTION public.save_web_page_draft_admin(
  p_page_id uuid,
  p_canvas_css text DEFAULT NULL,
  p_canvas_data jsonb DEFAULT NULL,
  p_canvas_html text DEFAULT NULL,
  p_expected_stamp timestamptz DEFAULT NULL,
  p_page_settings jsonb DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p public.web_pages%ROWTYPE;
  v_d_canvas_data jsonb;
  v_d_canvas_html text;
  v_d_canvas_css text;
  v_d_page_settings jsonb;
  v_d_updated timestamptz;
  v_stamp timestamptz;
  v_new timestamptz;
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_p FROM public.web_pages WHERE id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Page not found';
  END IF;

  SELECT d.canvas_data, d.canvas_html, d.canvas_css, d.page_settings, d.updated_at
    INTO v_d_canvas_data, v_d_canvas_html, v_d_canvas_css, v_d_page_settings, v_d_updated
  FROM public.web_page_versions d
  WHERE d.page_id = p_page_id AND d.kind = 'draft'
  FOR UPDATE;

  v_stamp := GREATEST(v_p.updated_at, COALESCE(v_d_updated, v_p.updated_at));
  IF p_expected_stamp IS NOT NULL AND v_stamp <> p_expected_stamp THEN
    RAISE EXCEPTION 'Page changed since it was loaded (stamp % vs expected %)', v_stamp, p_expected_stamp
      USING ERRCODE = 'PT409';
  END IF;

  IF v_p.status IS DISTINCT FROM 'published' THEN
    -- Nezveřejněná stránka: živý zápis, nikdo ho nevidí.
    UPDATE public.web_pages SET
      canvas_data   = COALESCE(p_canvas_data, web_pages.canvas_data),
      canvas_html   = COALESCE(p_canvas_html, web_pages.canvas_html),
      canvas_css    = COALESCE(p_canvas_css,  web_pages.canvas_css),
      page_settings = COALESCE(p_page_settings, web_pages.page_settings)
    WHERE web_pages.id = p_page_id
    RETURNING web_pages.updated_at INTO v_new;

    PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_page_id::text,
      p_entity_type := 'web_page',
      p_new_values := jsonb_build_object('target', 'live'),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Saved unpublished web page',
      p_tags := ARRAY['admin', 'content', 'web_page', 'canvas'],
      p_user_id := auth.uid()
    );
    RETURN v_new;
  END IF;

  -- Zveřejněná stránka: koncept. Založí se ze živého stavu, pak se přepíše tím, co přišlo.
  INSERT INTO public.web_page_versions (
    page_id, version_number, kind, canvas_data, canvas_html, canvas_css, page_settings, created_by, updated_at
  ) VALUES (
    p_page_id, 0, 'draft',
    COALESCE(p_canvas_data, v_d_canvas_data, v_p.canvas_data, '{}'::jsonb),
    COALESCE(p_canvas_html, v_d_canvas_html, v_p.canvas_html),
    COALESCE(p_canvas_css,  v_d_canvas_css,  v_p.canvas_css),
    COALESCE(p_page_settings, v_d_page_settings, v_p.page_settings, '{}'::jsonb),
    auth.uid(), now()
  )
  ON CONFLICT (page_id) WHERE kind = 'draft' DO UPDATE SET
    canvas_data   = EXCLUDED.canvas_data,
    canvas_html   = EXCLUDED.canvas_html,
    canvas_css    = EXCLUDED.canvas_css,
    page_settings = EXCLUDED.page_settings,
    updated_at    = now()
  RETURNING web_page_versions.updated_at INTO v_new;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_page_id::text,
    p_entity_type := 'web_page',
    p_new_values := jsonb_build_object('target', 'draft'),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Saved web page draft',
    p_tags := ARRAY['admin', 'content', 'web_page', 'draft'],
    p_user_id := auth.uid()
  );
  -- Vrací se razítko stránky jako celku (web_page_edit_stamp), ne jen konceptu:
  -- živá stránka může být novější (seed, jiná cesta) a klient pak musí poslat právě to.
  RETURN GREATEST(v_p.updated_at, v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.save_web_page_draft_admin(uuid, text, jsonb, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_web_page_draft_admin(uuid, text, jsonb, text, timestamptz, jsonb) TO authenticated, service_role;
