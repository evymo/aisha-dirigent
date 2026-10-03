-- ============================================================================
-- Source of Truth: avp_propose_identity
-- Popis: TENKÝ ADAPTÉR karet a čipů AVP (obecná surová dráha
--        source_catalog_rows, zdroj 'avp-portal') → NÁVRHY vazeb identity.
--        Nic nezakládá a nic nepotvrzuje — předloží člověku, která karta AVP
--        je které vozidlo či řidič, a který čip patří ke které kartě.
--
-- KARTY (/cards, druh 'card'; vozidlo a řidič se liší `card_type`) → obecné
-- jádro twin_propose_identity_by_signals, klíč 'karta:<id>' (primary_id):
--   vozidlo  vehicle_type (SPZ nebo VIN, ~7 %) → vehicle_plate/_machine_plate/_vin  0,6
--            RZ ve jménu karty („MAN 7Z9 2093“)  → vehicle_plate/_machine_plate    0,5
--            inventární číslo (~22 %)           → vehicle_machine_id              0,5
--   řidič    jméno karty                        → driver_name                     0,3
--
-- ČIPY (/chips, druh 'chip': chip_code → card_id; karta jich může mít víc) —
-- TRANZITIVNĚ: čip, jehož karta už má POTVRZENOU vazbu, se navrhne na totéž
-- dvojče (klíč 'cip:<kód>', ref_kind field_identity, jistota 0,7,
-- „rule:avp-cip-karta“). Nižší jistota, protože API dává jen AKTUÁLNÍ
-- přiřazení čipu, ne historii přesunů; potvrzením platí vazba od té chvíle.
-- Čipy AVP nejsou tachografové karty — mezi systémy klíčem nejsou.
--
-- Klíče 'karta:' / 'cip:' musí být STEJNÉ jako v avp_project_fuelings.
--
-- Vrací: {vozidla, ridici: <výsledek jádra>, cipy: {kandidatu, navrzeno,
--         uz_navrzeno, zamitnuto_clovekem, potvrzeno}}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.avp_propose_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source    constant text := 'avp-portal';
  v_source    text;
  v_vozidla   jsonb;
  v_ridici    jsonb;
  v_cip       record;
  v_res       jsonb;
  v_kandidatu integer := 0;
  v_navrzeno  integer := 0;
  v_uz        integer := 0;
  v_zamitnuto integer := 0;
  v_potvrzeno integer := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'avp_propose_identity: service role required'
      USING ERRCODE = '42501';
  END IF;
  v_source := public.canonical_ingest_source(c_source);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'karta:' || c.external_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('vehicle_plate', 'vehicle_machine_plate', 'vehicle_vin'),
                                'value', nullif(btrim(c.fields->>'vehicle_type'), ''), 'weight', 0.6),
             jsonb_build_object('kinds', jsonb_build_array('vehicle_plate', 'vehicle_machine_plate'),
                                'value', x.rz[1] || x.rz[2], 'weight', 0.5),
             jsonb_build_object('kinds', jsonb_build_array('vehicle_machine_id'),
                                'value', nullif(btrim(c.fields->>'inventory_number'), ''), 'weight', 0.5)),
             '$[*] ? (@.value != null)')
         ) ORDER BY c.external_id), '[]'::jsonb)
    INTO v_vozidla
    FROM public.source_catalog_rows c
    -- Česká RZ ve jménu karty („MAN 7Z9 2093“ → 7Z92093); bez shody žádný signál.
    CROSS JOIN LATERAL (
      SELECT regexp_match(upper(coalesce(c.fields->>'name', '')), '([0-9][A-Z][A-Z0-9]) ?([0-9]{4})') AS rz
    ) x
   WHERE c.source_slug = c_source AND c.kind = 'card'
     AND lower(coalesce(c.fields->>'card_type', '')) = 'vehicle';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_key', 'karta:' || c.external_id,
           'signals', jsonb_path_query_array(jsonb_build_array(
             jsonb_build_object('kinds', jsonb_build_array('driver_name'),
                                'value', nullif(btrim(c.fields->>'name'), ''), 'weight', 0.3)),
             '$[*] ? (@.value != null)')
         ) ORDER BY c.external_id), '[]'::jsonb)
    INTO v_ridici
    FROM public.source_catalog_rows c
   WHERE c.source_slug = c_source AND c.kind = 'card'
     AND lower(coalesce(c.fields->>'card_type', '')) = 'driver';

  FOR v_cip IN
    SELECT 'cip:' || upper(btrim(ch.fields->>'chip_code')) AS klic, k.twin_id
      FROM public.source_catalog_rows ch
      JOIN public.twin_external_refs k
        ON k.source = v_source
       AND k.source_key = 'karta:' || (ch.fields->>'card_id')
       AND k.ref_kind = 'primary_id'
       AND k.state = 'confirmed'
       AND k.valid_to IS NULL
     WHERE ch.source_slug = c_source AND ch.kind = 'chip'
       AND nullif(btrim(ch.fields->>'chip_code'), '') IS NOT NULL
       AND nullif(ch.fields->>'card_id', '') IS NOT NULL
     ORDER BY 1
  LOOP
    v_kandidatu := v_kandidatu + 1;
    IF EXISTS (SELECT 1 FROM public.twin_external_refs r
                WHERE r.source = v_source AND r.source_key = v_cip.klic
                  AND r.ref_kind = 'field_identity' AND r.state = 'confirmed' AND r.valid_to IS NULL) THEN
      v_potvrzeno := v_potvrzeno + 1;
      CONTINUE;
    END IF;
    v_res := public.twin_identity_propose_match(
      v_cip.twin_id, v_source, v_cip.klic, 'field_identity', 'rule:avp-cip-karta', 0.7, NULL);
    CASE
      WHEN v_res->>'state' = 'skipped_rejected' THEN v_zamitnuto := v_zamitnuto + 1;
      WHEN coalesce((v_res->>'already')::boolean, false) THEN v_uz := v_uz + 1;
      ELSE v_navrzeno := v_navrzeno + 1;
    END CASE;
  END LOOP;

  RETURN jsonb_build_object(
    'vozidla', public.twin_propose_identity_by_signals(c_source, 'vehicle', v_vozidla, 'rule:signals'),
    'ridici',  public.twin_propose_identity_by_signals(c_source, 'driver',  v_ridici,  'rule:signals'),
    'cipy',    jsonb_build_object(
                 'kandidatu',          v_kandidatu,
                 'navrzeno',           v_navrzeno,
                 'uz_navrzeno',        v_uz,
                 'zamitnuto_clovekem', v_zamitnuto,
                 'potvrzeno',          v_potvrzeno)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.avp_propose_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avp_propose_identity() TO service_role;
