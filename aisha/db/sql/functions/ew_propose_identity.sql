-- ============================================================================
-- Source of Truth: ew_propose_identity
-- Popis: TENKÝ ADAPTÉR číselníků Eurowagu (obecná surová dráha
--        source_catalog_rows, zdroj 'eurowag-telematics', druhy 'vehicle'
--        a 'driver') → twin_propose_identity_by_signals. Nic nezakládá a nic
--        nepotvrzuje — předloží člověku, které vozidlo/řidič Eurowagu je které
--        dvojče.
--
-- Klíče nesou druh objektu: 'vozidlo:<monitoredObjectId>', 'osoba:<driver id>'
-- — Eurowag čísluje vozidla i řidiče vlastní řadou a vazba identity je
-- jedinečná jen v (source, source_key, ref_kind), bez druhu entity (třída
-- chyby nalezená u T-cars 2026-09-27; verze 0.1.0 pluginu ji měla latentně).
-- Stejné klíče skládá ew_project_catalog.
--
-- Signály a síla (1 − Π(1 − w) přes shodné):
--   vozidlo  SPZ (`rn`)        → vehicle_plate/_machine_plate  0,6
--   řidič    jméno a příjmení  → driver_name                   0,3
--
-- Vrací: {vozidla, ridici: <výsledek jádra>}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ew_propose_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source  constant text := 'eurowag-telematics';
  v_vozidla jsonb;
  v_ridici  jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'ew_propose_identity: service role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'vozidlo:' || c.external_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('vehicle_plate', 'vehicle_machine_plate'),
                                'value', nullif(btrim(c.fields->>'rn'), ''), 'weight', 0.6)),
             '$[*] ? (@.value != null)')
         ) ORDER BY c.external_id), '[]'::jsonb)
    INTO v_vozidla
    FROM public.source_catalog_rows c
   WHERE c.source_slug = c_source AND c.kind = 'vehicle';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'osoba:' || c.external_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('driver_name'),
                                'value', nullif(btrim(concat_ws(' ', c.fields->>'name', c.fields->>'surname')), ''),
                                'weight', 0.3)),
             '$[*] ? (@.value != null)')
         ) ORDER BY c.external_id), '[]'::jsonb)
    INTO v_ridici
    FROM public.source_catalog_rows c
   WHERE c.source_slug = c_source AND c.kind = 'driver';

  RETURN jsonb_build_object(
    'vozidla', public.twin_propose_identity_by_signals(c_source, 'vehicle', v_vozidla, 'rule:signals'),
    'ridici',  public.twin_propose_identity_by_signals(c_source, 'driver',  v_ridici,  'rule:signals')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ew_propose_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_propose_identity() TO service_role;
