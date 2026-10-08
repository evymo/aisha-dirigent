-- ============================================================================
-- Source of Truth: meter_usage_between
-- Popis: Spotřeba měřidla mezi dvěma OKAMŽIKY, odvozená z odečtů K DATU podle
--        pravidla, které je DATA (deklarace u použití), ne kód.
-- ============================================================================
--
-- ⭐ ODEČET JE HODNOTA K DATU (majitel 2026-10-04): „je to prostě odečet k datu; jak a kam
-- vstupuje, jsou věci vždy dynamické, odvozené v čase — k termínu předání, pravidelně,
-- na vyžádání…“. Odečet proto NENESE roli (konec období, předání); roli odvozuje ten,
-- kdo se ptá — bilance, vyúčtování, předání — a říká si přitom PRAVIDLO:
--
--   'presny'        stav k okamžiku jen z odečtu PŘESNĚ k němu, jinak chybí
--                   (výchozí pro předání — k termínu je odečet povinný);
--   'posledni_pred' poslední odečet PŘED okamžikem (odhad; spotřebu přesouvá mezi obdobími);
--   'linearne'      lineárně mezi odečtem před a po okamžiku, poměrem času (odhad;
--                   výchozí pro bilanci a vyúčtování — majitel 2026-10-04).
-- Přesný odečet má VŽDY přednost: existuje-li odečet přesně k okamžiku, platí u každého
-- pravidla a není to odhad. Mimo rozsah odečtů se NEEXTRAPOLUJE (chybí).
--
-- VÝMĚNA MĚŘIDLA: odečet `kind = 'pocatek'`, který NENÍ prvním odečtem měřidla, začíná nový
-- počítadlo — skok hodnoty přes něj NENÍ spotřeba. Ve stejném okamžiku se starý stav
-- (`konec`, je-li) řadí před nový počátek. Lineární odvození PŘES výměnu bez odečtu
-- starého měřidla k ní je neznámo → chybí (nikdy tichá nula).
--
-- Na stejný (okamžik, druh) platí poslední zapsaný (created_at, pak id).
--
-- Vrací: {spotreba, jednotka, odhad, chybi, od_presne, do_presne}
--   spotreba  numeric|null — null když chybí;
--   odhad     true, když aspoň jeden konec není přesný odečet.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.meter_usage_between(
  p_twin_id  uuid,
  p_od       timestamptz,
  p_do       timestamptz,
  p_pravidlo text DEFAULT 'linearne'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
-- INVOKER: odečty čte RLS volajícího (jako get_meter_balance_block, která ji volá).
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r        record;
  v_prev   numeric;
  v_u      numeric := 0;
  v_unit   text;
  ts       timestamptz[] := '{}';
  us       numeric[]     := '{}';
  vymena   boolean[]     := '{}';
  n        int;
  v_stav_od jsonb;
  v_stav_do jsonb;
BEGIN
  IF p_pravidlo IS NULL OR p_pravidlo NOT IN ('presny', 'posledni_pred', 'linearne') THEN
    RAISE EXCEPTION 'meter_usage_between: neznámé pravidlo "%" (presny | posledni_pred | linearne)', p_pravidlo
      USING ERRCODE = '22023';
  END IF;
  IF p_od IS NULL OR p_do IS NULL OR p_do <= p_od THEN
    RAISE EXCEPTION 'meter_usage_between: období musí mít od < do' USING ERRCODE = '22023';
  END IF;

  -- Kumulativní spotřeba U v okamžiku každého odečtu (bez skoků přes výměnu).
  FOR r IN
    SELECT DISTINCT ON (e.occurred_at, coalesce(e.attrs->>'kind', ''))
           e.occurred_at, coalesce(e.attrs->>'kind', '') AS druh,
           (e.attrs->>'value')::numeric AS v, e.attrs->>'unit' AS jednotka
      FROM public.twin_events e
     WHERE e.twin_id = p_twin_id
       AND e.event_type = 'meter_reading'
       AND jsonb_typeof(e.attrs->'value') = 'number'
     -- 'konec' (k) se řadí před 'pocatek' (p) — starý stav před novým počítadlem téhož okamžiku.
     ORDER BY e.occurred_at, coalesce(e.attrs->>'kind', ''), e.created_at DESC, e.id DESC
  LOOP
    IF v_prev IS NULL THEN
      v_u := 0;
      vymena := vymena || false;
    ELSIF r.druh = 'pocatek' THEN
      vymena := vymena || true;          -- nové počítadlo: skok není spotřeba
    ELSE
      v_u := v_u + (r.v - v_prev);
      vymena := vymena || false;
    END IF;
    ts := ts || r.occurred_at;
    us := us || v_u;
    v_prev := r.v;
    v_unit := coalesce(r.jednotka, v_unit);
  END LOOP;
  n := coalesce(array_length(ts, 1), 0);

  v_stav_od := public.meter_usage_stav_k(ts, us, vymena, n, p_od, p_pravidlo);
  v_stav_do := public.meter_usage_stav_k(ts, us, vymena, n, p_do, p_pravidlo);

  RETURN jsonb_build_object(
    'spotreba',  CASE WHEN (v_stav_od->>'u') IS NULL OR (v_stav_do->>'u') IS NULL THEN NULL
                      ELSE (v_stav_do->>'u')::numeric - (v_stav_od->>'u')::numeric END,
    'jednotka',  v_unit,
    'chybi',     (v_stav_od->>'u') IS NULL OR (v_stav_do->>'u') IS NULL,
    'odhad',     NOT ((v_stav_od->>'presne')::boolean AND (v_stav_do->>'presne')::boolean),
    'od_presne', (v_stav_od->>'presne')::boolean,
    'do_presne', (v_stav_do->>'presne')::boolean);
END;
$function$;

COMMENT ON FUNCTION public.meter_usage_between(uuid, timestamptz, timestamptz, text) IS
  'Spotřeba měřidla mezi dvěma okamžiky z odečtů k datu podle pravidla (presny | posledni_pred | linearne); přesný odečet má přednost, mimo rozsah se neextrapoluje, výměna měřidla (pocatek) není spotřeba.';

REVOKE ALL ON FUNCTION public.meter_usage_between(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meter_usage_between(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meter_usage_between(uuid, timestamptz, timestamptz, text) TO service_role;
