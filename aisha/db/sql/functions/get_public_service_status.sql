-- Function: public.get_public_service_status
-- Arguments: (none)
-- Security: SECURITY DEFINER + anon grant = VĚDOMĚ VEŘEJNÁ (viz níž).
--
-- Veřejný provozní stav pro anonymního návštěvníka — čte se týmž anon klíčem,
-- jakým si stránka bere překlady a obsah, takže žádný nový kanál nevzniká.
--
-- CO VYDÁ A PROČ PRÁVĚ TOHLE
-- Tři stavy (`ok` / `degraded` / `down`) a čas poslední kontroly. Není to
-- zhrubnutí kvůli opatrnosti — je to přesně tolik, kolik se dá pravdivě říct
-- návštěvníkovi, který se ptá „funguje to?". Procenta, jména služeb ani počty
-- by nebyly přesnější, jen konkrétnější: ven by nesly topologii instance.
--
-- ODKUD ČTE A PROČ NE ZE ZDROJE
-- Čte pohled `public_service_health`, ne `integration_services`. Zdrojová
-- tabulka drží vedle stavu i `api_token`, `base_url` a `config`; první verze
-- téhle funkce ji četla přímo a byla bezpečná jen tím, JAK měla napsaný SELECT
-- — tedy do první úpravy. Brána `security.gate` to 2026-08-02 odmítla („NEW
-- sensitive data functions with anon grant") a měla pravdu. Oprava je v tom,
-- že veřejná cesta nemá tajemství na dosah, ne že je jen nečte.
--
-- Audit: NEZAPISUJE. Anonymní čtení se v tomhle stacku nelogují (viz
-- get_public_homepage_stats a spol.); zápis na každý zásah zvenčí by z
-- audit_journal udělal odpadkový koš a levnou cestu, jak ho zahltit.

CREATE OR REPLACE FUNCTION public.get_public_service_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 STABLE
AS $function$
DECLARE
  v_sledovanych  integer;
  v_nezdravych   integer;
  v_posledni     timestamptz;
  v_stav         text;
BEGIN
  -- Jmenovitě tři sloupce, žádná hvězdička: co přibude do tabulky, sem nepronikne.
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE health_status IS DISTINCT FROM 'healthy')::int,
    MAX(last_health_check)
  INTO v_sledovanych, v_nezdravych, v_posledni
  FROM public.public_service_health
  WHERE is_active = true;

  v_stav := CASE
    -- Žádná sledovaná služba není výpadek, ale nevědomost — a ta se přiznává.
    WHEN COALESCE(v_sledovanych, 0) = 0 THEN 'unknown'
    WHEN COALESCE(v_nezdravych, 0) = 0 THEN 'ok'
    WHEN v_nezdravych >= v_sledovanych THEN 'down'
    ELSE 'degraded'
  END;

  RETURN jsonb_build_object(
    'status', v_stav,
    -- Zaokrouhleno na minutu: přesná sekunda by prozrazovala kadenci kontrol.
    'checked_at', date_trunc('minute', v_posledni)
  );
END;
$function$
;

-- Permissions (PUBLIC: provozní stav pro všechny návštěvníky)
REVOKE ALL ON FUNCTION public.get_public_service_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_service_status() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_service_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_service_status() TO service_role;
