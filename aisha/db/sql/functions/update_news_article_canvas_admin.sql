-- Function: public.update_news_article_canvas_admin
-- Description: Vstup editoru plátna (CanvasEditor → useUpdateNewsArticleCanvas).
--              Od 2026-09-24 už sám nezapisuje: rozhoduje jen mezi „ulož"
--              (save_news_article_draft_admin — u zveřejněného článku KONCEPT,
--              jinak živý stav) a „zveřejni" (publish_news_article_admin).
--              Vrací nové razítko pro souběžnou kontrolu (p_expected_stamp).
--
-- ⛔ Do 2026-09-24 psala rovnou do canvas_html, které čte veřejná stránka —
--    autosave 5 s po změně tak u zveřejněného článku šel na web i s nedopsanou
--    větou. Nový parametr + návratový typ = nový podpis, proto DROP (PostgREST by
--    jinak měl dvě přetížení a volání s pojmenovanými argumenty odmítl).
-- Security: SECURITY DEFINER; autorizuje sám (admin/staff) — i když volané
--           funkce autorizují znovu, delegát bez vlastní stráže je orákulum.
--           Audit: zápisy auditují volané funkce; zveřejnění z editoru se navíc
--           zapíše jako událost editoru (write_audit_journal).

DROP FUNCTION IF EXISTS public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean);

CREATE OR REPLACE FUNCTION public.update_news_article_canvas_admin(
  p_id uuid,
  p_canvas_data jsonb DEFAULT NULL,
  p_canvas_html text DEFAULT NULL,
  p_canvas_css text DEFAULT NULL,
  p_publish boolean DEFAULT false,
  p_expected_stamp timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stamp timestamptz;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_publish THEN
    v_stamp := public.publish_news_article_admin(p_id, p_canvas_css, p_canvas_data, p_canvas_html, p_expected_stamp, NULL);
    PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'news_article',
      p_new_values := jsonb_build_object('publish', true, 'source', 'canvas_editor'),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Published news article from the canvas editor',
      p_tags := ARRAY['admin', 'content', 'news_article', 'canvas'],
      p_user_id := auth.uid()
    );
    RETURN v_stamp;
  END IF;

  RETURN public.save_news_article_draft_admin(p_id, p_canvas_css, p_canvas_data, p_canvas_html, p_expected_stamp, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean, timestamptz) TO authenticated;
