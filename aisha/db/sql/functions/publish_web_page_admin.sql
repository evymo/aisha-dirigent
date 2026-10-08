-- Function: public.publish_web_page_admin
-- Description: „Zveřejnit změny": přelije do web_pages to, co přišlo, jinak
--              koncept (je-li), nastaví status 'published', koncept smaže
--              a zapíše verzi 'published' (každé zveřejnění se dá obnovit).
--              Bez konceptu i bez obsahu jen zveřejní současný živý stav.
--
--              Souběh: p_expected_stamp jako u save_web_page_draft_admin (409).
--
-- ⛔ Verzi zapisuje SERVER ve stejné transakci. Dřív ji po zveřejnění zakládal
--    klient zvláštním voláním create_web_page_version — a to padalo na RLS
--    audit_journal (INVOKER), takže zveřejnění nemělo historii (2026-10-02).
-- Security: SECURITY DEFINER; admin/staff NEBO service_role.
-- Created: 2026-10-02 (zrcadlí publish_news_article_admin)

CREATE OR REPLACE FUNCTION public.publish_web_page_admin(
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
  v_verze uuid;
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

  UPDATE public.web_pages SET
    canvas_data   = COALESCE(p_canvas_data, v_d_canvas_data, web_pages.canvas_data),
    canvas_html   = COALESCE(p_canvas_html, v_d_canvas_html, web_pages.canvas_html),
    canvas_css    = COALESCE(p_canvas_css,  v_d_canvas_css,  web_pages.canvas_css),
    page_settings = COALESCE(p_page_settings, v_d_page_settings, web_pages.page_settings),
    status        = 'published'
  WHERE web_pages.id = p_page_id
  RETURNING web_pages.updated_at INTO v_new;

  DELETE FROM public.web_page_versions d
  WHERE d.page_id = p_page_id AND d.kind = 'draft';

  v_verze := public.create_web_page_version(p_page_id, 'publish');
  UPDATE public.web_page_versions SET kind = 'published' WHERE id = v_verze;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_page_id::text,
    p_entity_type := 'web_page',
    p_new_values := jsonb_build_object('publish', true, 'had_draft', v_d_updated IS NOT NULL, 'version_id', v_verze),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Published web page',
    p_tags := ARRAY['admin', 'content', 'web_page', 'publish'],
    p_user_id := auth.uid()
  );
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_web_page_admin(uuid, text, jsonb, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_web_page_admin(uuid, text, jsonb, text, timestamptz, jsonb) TO authenticated, service_role;
