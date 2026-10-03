-- ============================================================================
-- Source of Truth: kiosk_projekce
-- Popis: CO Z KROKU SMÍ NA TABLET (F2-C). Jediné místo, které z `input_data` kroku
--        vybere klíče povolené rozsahem instance (`kiosk_rozsah.pole` všech aktivních
--        řádků, které krok pokrývají). Používají ji všechna čtení pro účet zařízení
--        (get_kiosk_rozvozy, get_workflow_step_detail) — dvě kopie by se rozešly
--        a osobní údaj by utekl tou, na kterou se zapomnělo.
--
-- ⭐ Majitel 2026-09-29: osobní údaje odběratele (přebírající, kontakty, telefon,
--    e-mail) na tablet NEJDOU. Co jde, určuje instance v datech (`pole`), ne kód.
--
-- Bez pokrývajícího řádku = prázdný objekt (fail-closed). Interní pomocník volaný
-- z SECURITY DEFINER čtení: klientům žádný grant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kiosk_projekce(p_step_code text, p_input jsonb)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    FROM jsonb_each(coalesce(p_input, '{}'::jsonb)) e
   WHERE e.key IN (SELECT p
                     FROM public.kiosk_rozsah r, unnest(r.pole) p
                    WHERE r.aktivni
                      AND r.step_code = p_step_code
                      AND coalesce(p_input, '{}'::jsonb) @> r.input_match)
$function$;

REVOKE ALL ON FUNCTION public.kiosk_projekce(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_projekce(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_projekce(text, jsonb) TO service_role;
