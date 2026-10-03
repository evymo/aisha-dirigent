-- =============================================================================
-- zarizeni_deklarace_zapis(deklarace, commit) — zapíše deklaraci zařízení.
--
-- Volá ji hák dat instance (`NN_zarizeni_deklarace.sql` v datech instance,
-- psql jako service_role) s DOSLOVNÝM obsahem `zarizeni/hlidac.json`.
--
-- ⛔ Hlídá jen, že jde o JSON objekt s `applicationId` — celý tvar ověřuje CI dat
--    instance před sloučením a storage-auth při čtení (viz tables/zarizeni_deklarace.sql).
--    Nesmysl tady = chyba = červená migrace, stejně jako u ostatních dat instance.
-- ⛔ Jen service role: zápis deklarace určuje, co se instaluje na tablety.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.zarizeni_deklarace_zapis(p_deklarace jsonb, p_commit text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: service_role required' USING errcode = '42501';
  END IF;
  IF p_deklarace IS NULL OR jsonb_typeof(p_deklarace) <> 'object' OR NOT (p_deklarace ? 'applicationId') THEN
    RAISE EXCEPTION 'deklarace zařízení musí být JSON objekt s applicationId' USING errcode = '22023';
  END IF;
  INSERT INTO public.zarizeni_deklarace (jedina, deklarace, zdroj_commit, zapsano)
  VALUES (true, p_deklarace, NULLIF(p_commit, ''), now())
  ON CONFLICT (jedina) DO UPDATE
    SET deklarace = EXCLUDED.deklarace,
        zdroj_commit = EXCLUDED.zdroj_commit,
        zapsano = now();
END;
$$;

REVOKE ALL ON FUNCTION public.zarizeni_deklarace_zapis(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zarizeni_deklarace_zapis(jsonb, text) TO service_role;
