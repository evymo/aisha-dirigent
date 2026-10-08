-- Function: public.update_web_page_canvas_admin
-- Description: Vstup editoru plátna (CanvasEditor → useUpdateWebPageCanvas).
--              Od 2026-10-02 už sám nezapisuje: rozhoduje jen mezi „ulož"
--              (save_web_page_draft_admin — u zveřejněné stránky KONCEPT, jinak
--              živý stav) a „zveřejni" (publish_web_page_admin, zapíše i verzi).
--              Vrací nové razítko pro souběžnou kontrolu (p_expected_stamp).
--
-- ⛔ Do 2026-10-02 psala rovnou do canvas_html, které čte veřejný web — autosave
--    5 s po změně tak u zveřejněné stránky šel na web i s rozpracovaným pokusem
--    (z instance: „the page got all messed up"). Nový parametr + návratový typ =
--    nový podpis, proto DROP (PostgREST by jinak měl dvě přetížení a volání
--    s pojmenovanými argumenty odmítl).
-- Security: SECURITY DEFINER; autorizuje sám (admin/staff) — i když volané
--           funkce autorizují znovu, delegát bez vlastní stráže je orákulum.
--           Audit zapisují volané funkce.
-- Created: 2026-04-11 · přepsáno 2026-10-02 (koncept)

DROP FUNCTION IF EXISTS public.update_web_page_canvas_admin(uuid, jsonb, text, text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.update_web_page_canvas_admin(
  p_id uuid,
  p_canvas_data jsonb DEFAULT NULL,
  p_canvas_html text DEFAULT NULL,
  p_canvas_css text DEFAULT NULL,
  p_page_settings jsonb DEFAULT NULL,
  p_publish boolean DEFAULT false,
  p_expected_stamp timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_publish THEN
    RETURN public.publish_web_page_admin(p_id, p_canvas_css, p_canvas_data, p_canvas_html, p_expected_stamp, p_page_settings);
  END IF;

  RETURN public.save_web_page_draft_admin(p_id, p_canvas_css, p_canvas_data, p_canvas_html, p_expected_stamp, p_page_settings);
END;
$$;

REVOKE ALL ON FUNCTION public.update_web_page_canvas_admin(uuid, jsonb, text, text, jsonb, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_web_page_canvas_admin(uuid, jsonb, text, text, jsonb, boolean, timestamptz) TO authenticated;
