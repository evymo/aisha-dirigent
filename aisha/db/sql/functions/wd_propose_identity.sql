-- ============================================================================
-- Source of Truth: wd_propose_identity
-- Popis: TENKÝ ADAPTÉR číselníků Webdispečinku (wd_vehicles, wd_drivers) →
--        twin_propose_identity_by_signals. Řekne, který údaj WD odpovídá
--        kterému druhu reference ve světě dvojčat; párování, jistotu a návrhy
--        dělá obecné jádro. Nic nezakládá a nic nepotvrzuje.
--
-- Zdroj identity je 'webdispecink' — kanonický slug světa dvojčat (stejný jako
-- wd_twin_fleet_current), ne slug pluginu 'webdispecink-fleet'.
-- Klíče: vozidlo = HOLÉ wd_car_id (konvence jádra, wd_twin_fleet_current),
-- řidič = 'ridic:<wd_driver_id>' — vazba identity je jedinečná jen v (source,
-- source_key, ref_kind), bez druhu entity, a WD čísluje vozidla i řidiče
-- vlastní řadou; holé číslo řidiče by kolidovalo s vozidlem (třída chyby
-- nalezená u T-cars 2026-09-27). Stejné klíče musí skládat wd_project_rides
-- i wd_project_worktime. Změřeno 2026-09-27: v produkci pod 'webdispecink'
-- žádná vazba neexistuje, nový tvar tedy nic nezdvojí.
--
-- Signály a síla (1 − Π(1 − w) přes shodné):
--   vozidlo  identifikátor (SPZ nebo název) → vehicle_plate/_machine_plate/_machine_id  0,6
--            RZ v popisu vozidla             → vehicle_plate/_machine_plate              0,5
--   řidič    osobní číslo                    → driver_personal_number                    0,7
--            jméno a příjmení                → driver_name                               0,3
--
-- Vrací: {vozidla, ridici: <výsledek jádra>}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wd_propose_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source  constant text := 'webdispecink';
  v_vozidla jsonb;
  v_ridici  jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'wd_propose_identity: service role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', v.wd_car_id::text,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('vehicle_plate', 'vehicle_machine_plate', 'vehicle_machine_id'),
                                'value', nullif(btrim(v.identifier), ''), 'weight', 0.6),
             jsonb_build_object('kinds', jsonb_build_array('vehicle_plate', 'vehicle_machine_plate'),
                                'value', x.rz[1] || x.rz[2], 'weight', 0.5)),
             '$[*] ? (@.value != null)')
         ) ORDER BY v.wd_car_id), '[]'::jsonb)
    INTO v_vozidla
    FROM public.wd_vehicles v
    CROSS JOIN LATERAL (
      SELECT regexp_match(upper(coalesce(v.description, '')), '([0-9][A-Z][A-Z0-9]) ?([0-9]{4})') AS rz
    ) x
   WHERE v.active;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'ridic:' || d.wd_driver_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('driver_personal_number'),
                                'value', nullif(btrim(d.personal_number), ''), 'weight', 0.7),
             jsonb_build_object('kinds', jsonb_build_array('driver_name'),
                                'value', nullif(btrim(concat_ws(' ', d.first_name, d.last_name)), ''), 'weight', 0.3)),
             '$[*] ? (@.value != null)')
         ) ORDER BY d.wd_driver_id), '[]'::jsonb)
    INTO v_ridici
    FROM public.wd_drivers d
   WHERE d.active;

  RETURN jsonb_build_object(
    'vozidla', public.twin_propose_identity_by_signals(c_source, 'vehicle', v_vozidla, 'rule:signals'),
    'ridici',  public.twin_propose_identity_by_signals(c_source, 'driver',  v_ridici,  'rule:signals')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wd_propose_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wd_propose_identity() TO service_role;
