-- Function: public.news_article_check_fields
-- Description: Ověří tvar hlavičky článku přicházející z klienta (p_fields):
--              ohnisko 0–1, přiblížení 1–4, štítky = pole textů, texty = objekt
--              po jazycích. Vadný vstup skončí výjimkou, ne tichým přeskočením —
--              koncept se ukládá automaticky a nikdo se na chybu nedívá.
-- Security: čistá validace, bez čtení tabulek.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.news_article_check_fields(p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_n numeric;
BEGIN
  IF p_fields IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'fields must be a JSON object';
  END IF;

  IF p_fields ? 'image_url' AND jsonb_typeof(p_fields -> 'image_url') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'fields.image_url must be a string or null';
  END IF;

  IF p_fields ? 'image_focus_x' THEN
    v_n := (p_fields ->> 'image_focus_x')::numeric;
    IF v_n IS NULL OR v_n < 0 OR v_n > 1 THEN RAISE EXCEPTION 'fields.image_focus_x must be within 0..1'; END IF;
  END IF;
  IF p_fields ? 'image_focus_y' THEN
    v_n := (p_fields ->> 'image_focus_y')::numeric;
    IF v_n IS NULL OR v_n < 0 OR v_n > 1 THEN RAISE EXCEPTION 'fields.image_focus_y must be within 0..1'; END IF;
  END IF;
  IF p_fields ? 'image_zoom' THEN
    v_n := (p_fields ->> 'image_zoom')::numeric;
    IF v_n IS NULL OR v_n < 1 OR v_n > 4 THEN RAISE EXCEPTION 'fields.image_zoom must be within 1..4'; END IF;
  END IF;

  IF p_fields ? 'tags' THEN
    IF jsonb_typeof(p_fields -> 'tags') <> 'array' THEN
      RAISE EXCEPTION 'fields.tags must be an array of strings';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_fields -> 'tags') x WHERE jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'fields.tags must be an array of strings';
    END IF;
  END IF;

  IF p_fields ? 'texts' AND jsonb_typeof(p_fields -> 'texts') <> 'object' THEN
    RAISE EXCEPTION 'fields.texts must be an object keyed by locale';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.news_article_check_fields(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.news_article_check_fields(jsonb) TO authenticated, service_role;
