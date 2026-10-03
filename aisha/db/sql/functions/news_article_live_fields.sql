-- Function: public.news_article_live_fields
-- Description: Hlavička článku tak, jak ji vidí web (živý stav), jako jeden JSON:
--              {image_url, image_focus_x, image_focus_y, image_zoom, tags, texts}.
--              Stejný tvar nese `news_article_versions.fields` — snímek verze i
--              koncept z něj vycházejí, takže „obnovit verzi" a „založit koncept"
--              čtou a píší tentýž tvar.
-- Security: SECURITY DEFINER (čte i NEZVEŘEJNĚNÝ článek) — proto autorizuje sám:
--           admin/staff nebo service_role. „Volá se jen zevnitř" není autorizace.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.news_article_live_fields(p_article_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
             'image_url',     a.image_url,
             'image_focus_x', a.image_focus_x,
             'image_focus_y', a.image_focus_y,
             'image_zoom',    a.image_zoom,
             'tags',          to_jsonb(a.tags),
             'texts',         public.news_article_texts(a.id)
           )
    FROM public.news_articles a
    WHERE a.id = p_article_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.news_article_live_fields(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.news_article_live_fields(uuid) TO authenticated, service_role;
