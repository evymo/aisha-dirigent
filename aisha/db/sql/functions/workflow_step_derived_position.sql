-- ============================================================================
-- Source of Truth: workflow_step_derived_position
-- Popis: Kde se milník odehrál — ODVOZENO, nikdy z klienta.
--
--   Poloha je u předání důkaz, a důkaz nesmí dodávat ten, koho dokumentuje.
--   Geolokace z prohlížeče navíc hlásí telefon řidiče, ne vozidlo: je
--   podvržitelná, potřebuje souhlas s oprávněním a duplikuje signál, který už
--   vlastníme s lepší provenancí (identita z tachografu).
--
--   Dvě cesty, v tomhle pořadí:
--     1. PŘÍJEZDOVÝ SIGNÁL — uzel téhož běhu, který se dokončuje signálem
--        (`input_data ? 'complete_on'`), nese v `output_data->'payload'` to, co
--        adaptér poslal. Když v něm je poloha, je to přesně poloha předání.
--     2. TELEMATIKA — když signál polohu nenese, ale jmenuje vozidlo, vezme se
--        poslední známá poloha toho vozidla do času milníku.
--
--   Když neodpoví ani jedna, vrátí `geo_source='unavailable'` s důvodem. Prázdno
--   je signál k dotažení lane, ne důvod psát nulové souřadnice.
--
--   ⚠️ Shoda vozidla je VÝHRADNĚ rovnost na `wd_vehicles.identifier`. Volnější
--   párování (description, normalizace SPZ) by tu vyrobilo falešnou shodu, a
--   falešná shoda je u důkazu horší než mezera.
--
--   `position_time` se vrací vždy, když se poloha našla — čtenář musí vidět,
--   jak stará je. Skrytý práh „čerstvosti" by tichounce zahodil pravdivý údaj.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT. Čte jen wd_* a běh, nic nezapisuje.
--   ⚠️ AUTORIZUJE SAMA SEBE, a musí. První verze spoléhala na to, že ji volá
--   výhradně submit_evidence_review_audited po kontrole milníku — jenže
--   `security definer` obchází RLS, takže grant pro `authenticated` z ní dělal
--   ORÁKULUM POLOHY: kdokoli přihlášený by dosazoval cizí step_id a dostával
--   souřadnice cizích vozidel. Chytila to brána security.gate (SEC_DEF_NO_AUTH),
--   ne já.
--   Dvojí obrana: grant má jen service_role (definer volající projdou i tak),
--   a tělo navíc ptá TÝŽ sdílený predikát jako fronta — workflow_step_visible_to
--   (přiřazení · role · potvrzená twin vazba). Kdo krok nesmí vidět, nesmí znát
--   ani místo, kde se odehrál.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.workflow_step_derived_position(p_step_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_step     public.production_workflow_steps%rowtype;
  v_uid      uuid := auth.uid();
  v_batch    uuid;
  v_at       timestamptz;
  v_payload  jsonb;
  v_lat      numeric;
  v_lon      numeric;
  v_vehicle  text;
  v_car      integer;
  v_pos      record;
BEGIN
  SELECT * INTO v_step
    FROM public.production_workflow_steps s
   WHERE s.id = p_step_id;

  -- Neexistující krok vypadá stejně jako krok, na který volající nemá nárok —
  -- záměrně. Rozlišit je by z odpovědi udělalo test existence cizích běhů.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('geo_source', 'unavailable', 'reason', 'step_not_found');
  END IF;

  IF NOT (public.is_service_role()
          OR public.is_admin_or_staff()
          OR public.workflow_step_visible_to(
               v_uid, v_step.assigned_user_id, v_step.assigned_role, v_step.input_data,
               NULL, v_step.step_code)) THEN
    RETURN jsonb_build_object('geo_source', 'unavailable', 'reason', 'step_not_found');
  END IF;

  v_batch := v_step.batch_id;
  v_at    := coalesce(v_step.completed_at, now());

  -- Poslední signálem dokončený uzel téhož běhu = příjezd na místo.
  SELECT s.output_data->'payload'
    INTO v_payload
    FROM public.production_workflow_steps s
   WHERE s.batch_id = v_batch
     AND s.input_data ? 'complete_on'
     AND s.output_data ? 'payload'
   ORDER BY s.step_order DESC
   LIMIT 1;

  IF v_payload IS NULL THEN
    RETURN jsonb_build_object('geo_source', 'unavailable', 'reason', 'no_arrival_signal');
  END IF;

  v_lat := nullif(v_payload->>'lat', '')::numeric;
  v_lon := nullif(v_payload->>'lon', '')::numeric;

  IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'geo_source', 'arrival_signal',
      'lat', v_lat, 'lon', v_lon,
      'place', v_payload->>'place'));
  END IF;

  v_vehicle := nullif(btrim(coalesce(v_payload->>'vehicle', '')), '');
  IF v_vehicle IS NULL THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'geo_source', 'unavailable', 'reason', 'signal_without_position_or_vehicle',
      'place', v_payload->>'place'));
  END IF;

  SELECT v.wd_car_id INTO v_car
    FROM public.wd_vehicles v
   WHERE v.identifier = v_vehicle
   LIMIT 1;

  IF v_car IS NULL THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'geo_source', 'unavailable', 'reason', 'vehicle_not_in_telematics',
      'vehicle', v_vehicle, 'place', v_payload->>'place'));
  END IF;

  SELECT h.latitude, h.longitude, h.position_time, h.location_text
    INTO v_pos
    FROM public.wd_vehicle_positions_history h
   WHERE h.wd_car_id = v_car
     AND h.position_time <= v_at
     AND h.latitude IS NOT NULL
     AND h.longitude IS NOT NULL
   ORDER BY h.position_time DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'geo_source', 'unavailable', 'reason', 'no_position_before_milestone',
      'vehicle', v_vehicle, 'place', v_payload->>'place'));
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'geo_source', 'telematics',
    'lat', v_pos.latitude, 'lon', v_pos.longitude,
    'position_time', v_pos.position_time,
    'place', coalesce(v_pos.location_text, v_payload->>'place'),
    'vehicle', v_vehicle));
END;
$$;

-- Žádný grant pro `authenticated`: tohle není blokové RPC, klient ho nevolá.
-- Jediná cesta k němu vede přes submit_evidence_review_audited, který je
-- SECURITY DEFINER, takže grant nepotřebuje.
REVOKE ALL ON FUNCTION public.workflow_step_derived_position(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_step_derived_position(uuid) TO service_role;
