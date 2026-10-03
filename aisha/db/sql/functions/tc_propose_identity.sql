-- ============================================================================
-- Source of Truth: tc_propose_identity
-- Popis: TENKÝ ADAPTÉR T-cars → twin_propose_identity_by_signals. Řekne, který
--        údaj číselníku T-cars odpovídá kterému druhu reference ve světě
--        dvojčat; párování, jistotu a návrhy dělá obecné jádro. Nic nezakládá
--        a nic nepotvrzuje — jen předloží člověku návrhy vazeb.
--
-- Signály a jejich síla (1 − Π(1 − w) přes shodné):
--   vozidlo  palubní jednotka  → vehicle_telemetry_unit        0,8 (výrobní číslo)
--            RZ                → vehicle_plate, vehicle_machine_plate  0,6
--            evidenční číslo   → vehicle_machine_id            0,5 (číslování firmy)
--   řidič    osobní číslo      → driver_personal_number        0,7
--            jméno             → driver_name                   0,3 (shoda jmen)
-- Jméno řidiče se NEPOROVNÁVÁ s cizím `primary_id`: co je primární klíč jiného
-- zdroje, ví jen ten zdroj (u ingestu jde o text, jehož tvar se liší).
--
-- ⛔ KLÍČ NESE DRUH OBJEKTU ('vozidlo:<vozidloId>', 'osoba:<osobaId>'). T-cars
-- čísluje vozidla a osoby ve DVOU nezávislých řadách, kdežto vazba identity je
-- jedinečná jen v (source, source_key, ref_kind) — bez druhu entity. S holým
-- číslem by si vozidlo 5 a osoba 5 vzaly týž klíč: potvrzené vozidlo by
-- „zabralo" řidiče a jízda by za řidiče dostala vozidlo (nalezeno 2026-09-27
-- před prvním spuštěním, v datech nic nevzniklo). Totéž platí v tc_project_rides.
--
-- Vrací: {vozidla: <výsledek jádra>, ridici: <výsledek jádra>}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tc_propose_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source  constant text := 'tcars-fleet';
  v_vozidla jsonb;
  v_ridici  jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'tc_propose_identity: service role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'vozidlo:' || v.tc_vehicle_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('vehicle_telemetry_unit'),
                                'value', v.unit_no, 'weight', 0.8),
             jsonb_build_object('kinds', jsonb_build_array('vehicle_plate', 'vehicle_machine_plate'),
                                'value', v.plate, 'weight', 0.6),
             jsonb_build_object('kinds', jsonb_build_array('vehicle_machine_id'),
                                'value', v.evidence_no, 'weight', 0.5)),
             '$[*] ? (@.value != null)')
         ) ORDER BY v.tc_vehicle_id), '[]'::jsonb)
    INTO v_vozidla
    FROM public.tc_vehicles v
   WHERE v.active;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'osoba:' || d.tc_driver_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('driver_personal_number'),
                                'value', d.personal_number, 'weight', 0.7),
             jsonb_build_object('kinds', jsonb_build_array('driver_name'),
                                'value', d.name, 'weight', 0.3)),
             '$[*] ? (@.value != null)')
         ) ORDER BY d.tc_driver_id), '[]'::jsonb)
    INTO v_ridici
    FROM public.tc_drivers d
   WHERE d.active;

  RETURN jsonb_build_object(
    'vozidla', public.twin_propose_identity_by_signals(c_source, 'vehicle', v_vozidla, 'rule:signals'),
    'ridici',  public.twin_propose_identity_by_signals(c_source, 'driver',  v_ridici,  'rule:signals')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tc_propose_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tc_propose_identity() TO service_role;
