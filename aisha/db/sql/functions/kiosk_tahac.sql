-- ============================================================================
-- Source of Truth: kiosk_tahac
-- Popis: Registrační značka TAHAČE ze zápisu soupravy (F2-C, výběr „podle vozidla“).
--        vehicle_registration nese i soupravu („1T2 3456/2T3 4567“, „…+…“): tahač je
--        první část před / , + ; velká písmena A–Z0–9 (měření RIQi 2026-09-29).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kiosk_tahac(p_rz text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT nullif(upper(regexp_replace(split_part(regexp_replace(coalesce(p_rz, ''), '[,+]', '/', 'g'), '/', 1),
                                     '[^A-Za-z0-9]', '', 'g')), '')
$function$;

REVOKE ALL ON FUNCTION public.kiosk_tahac(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_tahac(text) TO authenticated, service_role;
