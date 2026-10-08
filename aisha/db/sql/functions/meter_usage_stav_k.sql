-- ============================================================================
-- Source of Truth: meter_usage_stav_k
-- Popis: Kumulativní stav měřidla K OKAMŽIKU z již seřazených odečtů (pomocník
--        meter_usage_between — čistá funkce nad poli, bez přístupu k tabulkám).
-- ============================================================================
-- Vstup: ts[] okamžiky odečtů (vzestupně), us[] kumulativní spotřeba v nich (bez skoků
-- přes výměnu), vymena[] = odečet začíná nové počítadlo, n = počet, t = okamžik, pravidlo.
-- Výstup: {u: numeric|null, presne: boolean}. Pravidla viz meter_usage_between.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.meter_usage_stav_k(
  ts       timestamptz[],
  us       numeric[],
  vymena   boolean[],
  n        int,
  t        timestamptz,
  pravidlo text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i int;
  a int;
  b int;
BEGIN
  -- Přesný odečet k okamžiku má přednost u každého pravidla.
  FOR i IN REVERSE n..1 LOOP
    IF ts[i] = t THEN
      RETURN jsonb_build_object('u', us[i], 'presne', true);
    END IF;
  END LOOP;
  IF pravidlo = 'presny' THEN
    RETURN jsonb_build_object('u', NULL, 'presne', false);
  END IF;

  FOR i IN REVERSE n..1 LOOP
    IF ts[i] < t THEN a := i; EXIT; END IF;
  END LOOP;
  IF a IS NULL THEN                       -- před prvním odečtem se neextrapoluje
    RETURN jsonb_build_object('u', NULL, 'presne', false);
  END IF;
  IF pravidlo = 'posledni_pred' THEN
    RETURN jsonb_build_object('u', us[a], 'presne', false);
  END IF;

  -- 'linearne': mezi posledním odečtem před a prvním po okamžiku (sousedé v řadě).
  b := a + 1;
  IF b > n OR vymena[b] THEN              -- za posledním odečtem / přes výměnu bez stavu starého = neznámo
    RETURN jsonb_build_object('u', NULL, 'presne', false);
  END IF;
  RETURN jsonb_build_object(
    'u', us[a] + (us[b] - us[a]) * extract(epoch FROM (t - ts[a])) / extract(epoch FROM (ts[b] - ts[a])),
    'presne', false);
END;
$function$;

COMMENT ON FUNCTION public.meter_usage_stav_k(timestamptz[], numeric[], boolean[], int, timestamptz, text) IS
  'Pomocník meter_usage_between: kumulativní stav měřidla k okamžiku z odečtů podle pravidla; přesný odečet má přednost, neextrapoluje se, přes výměnu měřidla se neinterpoluje.';

REVOKE ALL ON FUNCTION public.meter_usage_stav_k(timestamptz[], numeric[], boolean[], int, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meter_usage_stav_k(timestamptz[], numeric[], boolean[], int, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meter_usage_stav_k(timestamptz[], numeric[], boolean[], int, timestamptz, text) TO service_role;
