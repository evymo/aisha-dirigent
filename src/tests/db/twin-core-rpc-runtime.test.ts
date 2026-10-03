import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * TWIN CORE (digital twin doménová vrstva) — real-DB runtime test.
 *
 * Proves the G5 layer end-to-end against a real Postgres (throwaway pg17 via
 * `npm run test:db`, which IS in CI):
 *
 *  1. twin_upsert_entity_audited is idempotent per (source, source_key,
 *     primary_id): first call creates twin + CONFIRMED primary ref (system
 *     confirmation, confirmed_by NULL), second call updates the same twin —
 *     no duplicate entity. twin_identity_resolve reads ONLY confirmed+valid.
 *  2. Ratification workflow: propose (evidence, no authority) → resolve still
 *     NULL → human confirm (admin, real auth.uid()) → resolve hits. A proposal
 *     on a key confirmed to ANOTHER twin never overwrites (conflict goes to
 *     review); confirm without supersede FAILS; supersede performs a chip
 *     handover (old ref keeps history via valid_to, resolve flips, historical
 *     p_at resolve still returns the old holder).
 *  3. Human gate: service_role can propose but must NOT confirm (ratification
 *     is human-only). twin_record_events_audited dedups on (source,
 *     event_type, source_ref) — re-import updates, never duplicates.
 *
 * RAISE inside the DO block → non-zero psql exit → execFileSync throws → test fails.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Twin Core RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

// Vozidlo WD 987654 (mapa flotily, test 3) po sadě ZMIZÍ: rohatka pouští soubory ve sdílené DB
// a `wd_propose_identity` (wd-projekce-dvojcata) počítá VŠECHNA aktivní wd_vehicles.
afterAll(() => {
  if (!dbAvailable) return;
  psqlMultiline(HEADER + `DELETE FROM public.wd_vehicle_positions_current WHERE wd_car_id = 987654;
DELETE FROM public.wd_vehicles WHERE wd_car_id = 987654;`);
});

// Fixture: jeden admin/staff user (ratifikátor). Non-admin není potřeba —
// negativní brány testujeme přes service_role claims (deterministické, bez
// závislosti na tom, co seed přesně naseeduje).
const FIXTURE = `
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
    WHERE ur.role IN ('admin','staff') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no admin/staff user seeded'; END IF;
`;

describe("twin core: upsert + identity ratification + events (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "upsert is idempotent per primary identity; resolve reads only confirmed",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; v_r jsonb; v_twin uuid; v_twin2 uuid; v_n int;
  v_label text; v_confirmed_by uuid; v_state text;
BEGIN
  ${FIXTURE}
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 1. vytvoření: twin + POTVRZENÁ primární ref (systémové potvrzení)
  v_r := public.twin_upsert_entity_audited('vehicle', 'twintest-src', 'car-9001', '3T2 1234');
  IF (v_r->>'created')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'expected created=true, got %', v_r; END IF;
  v_twin := (v_r->>'twin_id')::uuid;

  SELECT r.state, r.confirmed_by INTO v_state, v_confirmed_by
    FROM public.twin_external_refs r
    WHERE r.twin_id = v_twin AND r.source = 'twintest-src' AND r.ref_kind = 'primary_id';
  IF v_state <> 'confirmed' THEN RAISE EXCEPTION 'primary ref not confirmed: %', v_state; END IF;
  IF v_confirmed_by IS NOT NULL THEN RAISE EXCEPTION 'system confirmation must have confirmed_by NULL'; END IF;

  -- 2. idempotence: druhý upsert téhož klíče = TENTÝŽ twin, update labelu
  v_r := public.twin_upsert_entity_audited('vehicle', 'twintest-src', 'car-9001', '3T2 9999');
  IF (v_r->>'created')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'expected created=false, got %', v_r; END IF;
  v_twin2 := (v_r->>'twin_id')::uuid;
  IF v_twin2 <> v_twin THEN RAISE EXCEPTION 'duplicate twin created: % vs %', v_twin, v_twin2; END IF;

  SELECT count(*) INTO v_n FROM public.twin_entities t
    WHERE t.id = v_twin AND t.label = '3T2 9999';
  IF v_n <> 1 THEN RAISE EXCEPTION 'label not updated on re-upsert'; END IF;

  -- 3. resolve: potvrzená identita → twin; neznámý klíč → NULL (ne výjimka)
  IF public.twin_identity_resolve('twintest-src', 'car-9001') <> v_twin THEN
    RAISE EXCEPTION 'resolve did not return the twin';
  END IF;
  IF public.twin_identity_resolve('twintest-src', 'car-nonexistent') IS NOT NULL THEN
    RAISE EXCEPTION 'resolve of unknown key must be NULL';
  END IF;

  RAISE NOTICE 'twin upsert+resolve OK (twin=%)', v_twin;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "ratification: propose carries no authority; confirm is human; supersede = chip handover with history",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; v_r jsonb; v_a uuid; v_b uuid;
  v_ref_a uuid; v_ref_b uuid; v_failed boolean; v_n int;
BEGIN
  ${FIXTURE}
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  v_a := (public.twin_upsert_entity_audited('driver', 'twintest-src', 'drv-501', 'Novák')->>'twin_id')::uuid;
  v_b := (public.twin_upsert_entity_audited('driver', 'twintest-src', 'drv-502', 'Svoboda')->>'twin_id')::uuid;

  -- 1. návrh vazby čip→A: proposed, ŽÁDNÁ autorita (resolve = NULL)
  v_r := public.twin_identity_propose_binding(v_a, 'twintest-src', 'CHIP-1', 'field_identity', 'rule:dallas', 0.9);
  IF v_r->>'state' <> 'proposed' THEN RAISE EXCEPTION 'expected proposed, got %', v_r; END IF;
  v_ref_a := (v_r->>'ref_id')::uuid;
  IF public.twin_identity_resolve('twintest-src', 'CHIP-1', 'field_identity') IS NOT NULL THEN
    RAISE EXCEPTION 'proposed binding must not resolve (not authoritative)';
  END IF;

  -- 2. idempotence návrhu: shodný propose vrací týž řádek, fronta bez duplicit
  v_r := public.twin_identity_propose_binding(v_a, 'twintest-src', 'CHIP-1', 'field_identity', 'rule:dallas', 0.9);
  IF (v_r->>'already')::boolean IS NOT TRUE OR (v_r->>'ref_id')::uuid <> v_ref_a THEN
    RAISE EXCEPTION 'duplicate proposal created: %', v_r;
  END IF;

  -- 3. lidské potvrzení → autoritativní
  v_r := public.twin_identity_confirm_binding(v_ref_a);
  IF v_r->>'state' <> 'confirmed' THEN RAISE EXCEPTION 'confirm failed: %', v_r; END IF;
  IF public.twin_identity_resolve('twintest-src', 'CHIP-1', 'field_identity') <> v_a THEN
    RAISE EXCEPTION 'confirmed binding must resolve to A';
  END IF;
  SELECT count(*) INTO v_n FROM public.twin_external_refs r
    WHERE r.id = v_ref_a AND r.confirmed_by = v_admin;
  IF v_n <> 1 THEN RAISE EXCEPTION 'human confirmation must record confirmed_by'; END IF;

  -- 4. konfliktní návrh (čip drží A, navrhuje se B): jde do review, NEPŘEPISUJE
  v_r := public.twin_identity_propose_binding(v_b, 'twintest-src', 'CHIP-1', 'field_identity', 'import');
  IF (v_r->>'conflict')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'expected conflict=true, got %', v_r; END IF;
  v_ref_b := (v_r->>'ref_id')::uuid;
  IF public.twin_identity_resolve('twintest-src', 'CHIP-1', 'field_identity') <> v_a THEN
    RAISE EXCEPTION 'conflicting proposal must not change the confirmed owner';
  END IF;

  -- 5. potvrzení bez supersede musí SELHAT (aktivní vlastník existuje)
  v_failed := false;
  BEGIN
    PERFORM public.twin_identity_confirm_binding(v_ref_b);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'confirm without supersede must fail while owner active'; END IF;

  -- 6. handover: supersede ukončí platnost A (historie zůstává) a potvrdí B
  v_r := public.twin_identity_confirm_binding(v_ref_b, true);
  IF v_r->>'state' <> 'confirmed' THEN RAISE EXCEPTION 'supersede confirm failed: %', v_r; END IF;
  SELECT count(*) INTO v_n FROM public.twin_external_refs r
    WHERE r.id = v_ref_a AND r.state = 'confirmed' AND r.valid_to IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'old holder must keep confirmed state with valid_to set'; END IF;
  IF public.twin_identity_resolve('twintest-src', 'CHIP-1', 'field_identity') <> v_b THEN
    RAISE EXCEPTION 'after handover resolve must return B';
  END IF;

  -- 7. temporální resolve: „čí byl čip včera" → původní držitel A
  --    (now() je v transakci konstantní → posuneme okna ručně)
  UPDATE public.twin_external_refs SET valid_from = now() - interval '2 days', valid_to = now() - interval '1 hour' WHERE id = v_ref_a;
  UPDATE public.twin_external_refs SET valid_from = now() - interval '1 hour' WHERE id = v_ref_b;
  IF public.twin_identity_resolve('twintest-src', 'CHIP-1', 'field_identity', now() - interval '1 day') <> v_a THEN
    RAISE EXCEPTION 'historical resolve must return the holder valid at p_at';
  END IF;
  IF public.twin_identity_resolve('twintest-src', 'CHIP-1', 'field_identity') <> v_b THEN
    RAISE EXCEPTION 'current resolve must still return B';
  END IF;

  RAISE NOTICE 'ratification+handover OK';
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "service can propose but not confirm (human gate); events import is idempotent",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; v_r jsonb; v_v uuid; v_d uuid; v_ref uuid; v_failed boolean; v_n int;
BEGIN
  ${FIXTURE}
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_v := (public.twin_upsert_entity_audited('vehicle', 'twintest-src', 'car-9100', 'V1')->>'twin_id')::uuid;
  v_d := (public.twin_upsert_entity_audited('driver', 'twintest-src', 'drv-600', 'D1')->>'twin_id')::uuid;

  -- service_role kontext: upsert i propose smí…
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'fixture: service_role claims not effective'; END IF;
  PERFORM public.twin_upsert_entity_audited('vehicle', 'twintest-src', 'car-9101', 'V2');
  v_r := public.twin_identity_propose_binding(v_d, 'twintest-src', 'CHIP-9', 'field_identity', 'import');
  v_ref := (v_r->>'ref_id')::uuid;

  -- …ale ratifikace je VÝHRADNĚ lidská: service confirm musí selhat
  v_failed := false;
  BEGIN
    PERFORM public.twin_identity_confirm_binding(v_ref);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'service_role must not ratify bindings'; END IF;

  -- events: idempotentní import (dedup přes source+event_type+source_ref)
  v_r := public.twin_record_events_audited(jsonb_build_array(
    jsonb_build_object(
      'event_type', 'ride', 'twin_id', v_v, 'related_twin_id', v_d,
      'occurred_at', now() - interval '2 hours', 'source', 'twintest-src', 'source_ref', 'ride-1'
    )
  ));
  IF (v_r->>'inserted')::int <> 1 THEN RAISE EXCEPTION 'first import must insert, got %', v_r; END IF;

  -- zpětná oprava zdroje: stejné okno znovu, jízda dostala konec
  v_r := public.twin_record_events_audited(jsonb_build_array(
    jsonb_build_object(
      'event_type', 'ride', 'twin_id', v_v, 'related_twin_id', v_d,
      'occurred_at', now() - interval '2 hours', 'ended_at', now() - interval '1 hour',
      'source', 'twintest-src', 'source_ref', 'ride-1'
    )
  ));
  IF (v_r->>'updated')::int <> 1 THEN RAISE EXCEPTION 're-import must update, got %', v_r; END IF;

  SELECT count(*) INTO v_n FROM public.twin_events e
    WHERE e.source = 'twintest-src' AND e.source_ref = 'ride-1';
  IF v_n <> 1 THEN RAISE EXCEPTION 'dedup failed: % rows for ride-1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.twin_events e
    WHERE e.source = 'twintest-src' AND e.source_ref = 'ride-1' AND e.ended_at IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 're-import did not update ended_at'; END IF;

  -- dávka s duplicitou uvnitř: poslední výskyt vyhrává, ON CONFLICT nepadá
  v_r := public.twin_record_events_audited(jsonb_build_array(
    jsonb_build_object('event_type','ride','twin_id',v_v,'occurred_at',now(),'source','twintest-src','source_ref','ride-2'),
    jsonb_build_object('event_type','ride','twin_id',v_v,'occurred_at',now(),'ended_at',now(),'source','twintest-src','source_ref','ride-2')
  ));
  SELECT count(*) INTO v_n FROM public.twin_events e
    WHERE e.source = 'twintest-src' AND e.source_ref = 'ride-2' AND e.ended_at IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'in-batch dedup must keep the LAST occurrence'; END IF;

  RAISE NOTICE 'human gate + events idempotence OK';
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "wave 2: parameter seed bridge (v1 camelCase), account binding → list_mine, fleet map resolves twins",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; v_r jsonb; v_veh uuid; v_drv uuid; v_ref uuid; v_n int; v_item jsonb;
BEGIN
  ${FIXTURE}
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 1. seed most: v1 formát (camelCase entityType/dataType) → runtime katalog
  v_r := public.twin_upsert_parameter_definitions_audited(jsonb_build_array(
    jsonb_build_object(
      'code', 'twintest_util_pct', 'name', 'Využití', 'entityType', 'vehicle',
      'dataType', 'decimal', 'unit', '%', 'source', 'computed', 'aggregation', 'daily'
    )
  ));
  IF (v_r->>'inserted')::int <> 1 THEN RAISE EXCEPTION 'param seed insert failed: %', v_r; END IF;
  v_r := public.twin_upsert_parameter_definitions_audited(jsonb_build_array(
    jsonb_build_object(
      'code', 'twintest_util_pct', 'name', 'Využití vozidla', 'entityType', 'vehicle',
      'dataType', 'decimal', 'unit', '%', 'source', 'computed', 'aggregation', 'daily'
    )
  ));
  IF (v_r->>'updated')::int <> 1 THEN RAISE EXCEPTION 'param seed re-run must update: %', v_r; END IF;
  SELECT count(*) INTO v_n FROM public.twin_parameter_definitions d
    WHERE d.code = 'twintest_util_pct' AND d.name = 'Využití vozidla' AND d.entity_type = 'vehicle';
  IF v_n <> 1 THEN RAISE EXCEPTION 'camelCase v1 fields not mapped to snake_case columns'; END IF;

  -- 2. „moje věci": driver twin navázaný na účet uživatele (ratifikovaně) → list_mine
  v_veh := (public.twin_upsert_entity_audited('vehicle', 'webdispecink', '987654', 'Fleet V1')->>'twin_id')::uuid;
  v_drv := (public.twin_upsert_entity_audited('driver', 'webdispecink', 'drv-f1', 'Řidič F1')->>'twin_id')::uuid;
  -- ⛔ source = 'aisha_auth': vazba účtu má JEDINÝ zdroj (CHECK twin_external_refs_account_source, 2026-09-10).
  --    Dřív tu stálo 'keycloak' — a právě dvojice aisha_auth/keycloak je ta nejednoznačnost, kterou model zavírá.
  v_ref := (public.twin_identity_propose_binding(v_drv, 'aisha_auth', v_admin::text, 'account', 'human:test')->>'ref_id')::uuid;
  PERFORM public.twin_identity_confirm_binding(v_ref);
  v_r := public.twin_list_mine();
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_r) AS e
    WHERE (e->>'twin_id')::uuid = v_drv;
  IF v_n <> 1 THEN RAISE EXCEPTION 'list_mine must return the account-bound twin, got %', v_r; END IF;

  -- 3. mapa: poloha s čipem → vehicle twin (primary_id) + řidič TEMPORÁLNĚ (field_identity)
  v_ref := (public.twin_identity_propose_binding(v_drv, 'webdispecink', 'CHIP-F1', 'field_identity', 'rule:dallas', 0.95)->>'ref_id')::uuid;
  PERFORM public.twin_identity_confirm_binding(v_ref);
  -- zdrojová strana platformním slovesem (FK: poloha vyžaduje wd_vehicles řádek)
  PERFORM public.wd_upsert_vehicles_audited(jsonb_build_array(
    jsonb_build_object('wd_car_id', 987654, 'identifier', 'TEST-987654', 'active', true)
  ));
  -- vazba platí od now(); poloha je novější než začátek platnosti
  INSERT INTO public.wd_vehicle_positions_current
    (wd_car_id, driver_card, position_time, latitude, longitude, speed_kmh, moving, location_text)
  VALUES (987654, 'CHIP-F1', now() + interval '1 minute', 49.1951, 16.6068, 54, true, 'Brno')
  ON CONFLICT (wd_car_id) DO UPDATE SET
    driver_card = EXCLUDED.driver_card, position_time = EXCLUDED.position_time;

  v_r := public.wd_twin_fleet_current();
  SELECT e INTO v_item FROM jsonb_array_elements(v_r) AS e
    WHERE (e->>'wd_car_id')::int = 987654;
  IF v_item IS NULL THEN RAISE EXCEPTION 'fleet map missing the vehicle'; END IF;
  IF (v_item->>'vehicle_twin_id')::uuid IS DISTINCT FROM v_veh THEN
    RAISE EXCEPTION 'fleet map did not resolve vehicle twin: %', v_item;
  END IF;
  IF (v_item->>'driver_twin_id')::uuid IS DISTINCT FROM v_drv THEN
    RAISE EXCEPTION 'fleet map did not resolve driver via chip: %', v_item;
  END IF;

  RAISE NOTICE 'wave 2 OK (param bridge + list_mine + fleet map)';
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
