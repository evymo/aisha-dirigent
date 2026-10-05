-- Function: public.trigger_update_streak_on_health_checkin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:13+01:00

CREATE OR REPLACE FUNCTION public.trigger_update_streak_on_health_checkin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ⛔ BEZ STRÁŽE NA auth.uid() (2026-10-04). Do té doby tu stálo
  -- `IF auth.uid() IS NULL THEN RAISE 'Unauthorized'` — trigger funkci nejde
  -- zavolat přímo (RETURNS trigger), takže stráž neměla koho odmítat, jen
  -- shazovala KAŽDÝ zápis bez přihlášeného uživatele (služba, import, obnova
  -- dat): AFTER INSERT spadl a s ním i vložený check-in. Kdo smí check-in
  -- vložit, rozhoduje RLS tabulky a volající RPC; streak je jen důsledek.
  -- Sesterský trigger_update_streak_on_activity stráž nikdy neměl.
  PERFORM update_user_streak(NEW.user_id);
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.trigger_update_streak_on_health_checkin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_update_streak_on_health_checkin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trigger_update_streak_on_health_checkin() FROM authenticated;
