import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * DOPORUČENÍ IDENTIT Z INGESTU — real-DB runtime test (throwaway PG).
 *
 * Kontakt převzatý z CRM a účet v aplikaci jsou dvě dvojčata, dokud je někdo
 * nespáruje. Porovnávat je smí stroj, ale SPOJIT jen člověk. Tvrdí se:
 *   · fronta k porovnání nese navržené reference zdroje ingestu a jejich hodnotu;
 *   · dvojče s POTVRZENOU vazbou do cílového světa ve frontě NENÍ (nemá co řešit);
 *   · doporučení je NÁVRH — nikdy nevznikne potvrzená vazba a resolve ji nevidí;
 *   · ZAMÍTNUTÝ pár se nevrací (jinak by fronta nikdy nezkonvergovala);
 *   · PŘEVZETÍ KLÍČE od jiného dvojčete je ve frontě VIDĚT (conflict), ne skryté;
 *   · bez nároku (běžný přihlášený) nejde ani číst frontu, ani navrhovat.
 *
 * Potvrzení se tu volá přímo `twin_identity_confirm_binding` (lidská stráž:
 * admin/staff + skutečné auth.uid()). Jednotný auditní vstup kokpitu
 * `submit_evidence_review_audited('twin_identity', …)` přichází samostatnou
 * větví ratifikace — tenhle test na ní schválně NEstojí, aby měřil vlastní šev.
 * Vše v jedné transakci s ROLLBACK.
 */

const dbAvailable = isPgReachable();
const CRM = `ingest-test-${process.pid}-${Date.now()}`;
const UCTY = `ucty-test-${process.pid}-${Date.now()}`;
const CIZI = "00000000-0000-4000-8000-0000000000fe";

beforeAll(async () => {
  await reportTestCapabilities("Doporučení identit z ingestu");
});

describe("doporučení identit z ingestu", () => {
  it.skipIf(!dbAvailable)("porovnat smí stroj, spojit jen člověk; zamítnuté se nevrací", () => {
    const run = () =>
      psqlMultiline(`\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_admin uuid; v_twin uuid; v_twin2 uuid; v_hotovy uuid;
  v_items jsonb; v_r jsonb; v_ref uuid; v_failed boolean; v_stav text;
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
   WHERE ur.role IN ('admin','staff') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no admin/staff user seeded'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- dvojčata „z CRM": nesou navržený identifikační parametr (e-mail)
  v_twin  := (public.twin_upsert_entity_audited('person', '${CRM}', 'CRM-1', 'Jana z CRM')->>'twin_id')::uuid;
  v_twin2 := (public.twin_upsert_entity_audited('person', '${CRM}', 'CRM-2', 'Petr z CRM')->>'twin_id')::uuid;
  v_hotovy := (public.twin_upsert_entity_audited('person', '${CRM}', 'CRM-3', 'Už spárovaná')->>'twin_id')::uuid;
  PERFORM public.twin_identity_propose_binding(v_twin,  '${CRM}', 'jana@example.org', 'person.email', 'ingest', 0.5);
  PERFORM public.twin_identity_propose_binding(v_twin2, '${CRM}', 'petr@example.org', 'person.email', 'ingest', 0.5);
  PERFORM public.twin_identity_propose_binding(v_hotovy,'${CRM}', 'hotova@example.org', 'person.email', 'ingest', 0.5);
  -- třetí dvojče už do světa účtů POTVRZENĚ patří
  v_ref := (public.twin_identity_propose_binding(v_hotovy, '${UCTY}', 'u-hotovy', 'primary_id', 'rule:email', 0.9)->>'ref_id')::uuid;
  PERFORM public.twin_identity_confirm_binding(v_ref);

  -- 1. fronta k porovnání: dvě dvojčata, spárované tam není
  v_items := public.twin_identity_match_candidates('${CRM}', 'person.email', '${UCTY}', 100);
  IF jsonb_array_length(v_items) <> 2 THEN
    RAISE EXCEPTION 'čekám 2 kandidáty, mám %: %', jsonb_array_length(v_items), v_items;
  END IF;
  IF NOT (v_items @> '[{"value":"jana@example.org"}]'::jsonb) THEN
    RAISE EXCEPTION 'fronta musí nést porovnávanou hodnotu: %', v_items;
  END IF;
  IF v_items::text LIKE '%hotova@example.org%' THEN
    RAISE EXCEPTION 'dvojče s potvrzenou vazbou do cílového světa ve frontě být nesmí';
  END IF;

  -- 2. doporučení je NÁVRH: nic se nespojí, resolve nic nenajde
  v_r := public.twin_identity_propose_match(v_twin, '${UCTY}', 'u-jana', 'primary_id', 'rule:email', 0.9);
  IF v_r->>'state' <> 'proposed' THEN RAISE EXCEPTION 'doporučení musí být návrh, dostal jsem %', v_r; END IF;
  IF public.twin_identity_resolve('${UCTY}', 'u-jana') IS NOT NULL THEN
    RAISE EXCEPTION 'NÁVRH nesmí být vidět jako vazba — resolve ji našel';
  END IF;
  -- opakovaný takt nezaloží druhý návrh
  v_r := public.twin_identity_propose_match(v_twin, '${UCTY}', 'u-jana', 'primary_id', 'rule:email', 0.9);
  IF NOT coalesce((v_r->>'already')::boolean, false) THEN
    RAISE EXCEPTION 'druhý takt nesmí zakládat duplicitní návrh: %', v_r;
  END IF;

  -- 3. lidské „ne" se nepřehlasuje
  v_ref := (public.twin_identity_propose_match(v_twin2, '${UCTY}', 'u-petr', 'primary_id', 'rule:email', 0.9)->>'ref_id')::uuid;
  PERFORM public.twin_identity_reject_binding(v_ref, 'jiná osoba');
  v_r := public.twin_identity_propose_match(v_twin2, '${UCTY}', 'u-petr', 'primary_id', 'rule:email', 0.9);
  IF v_r->>'state' <> 'skipped_rejected' THEN
    RAISE EXCEPTION 'zamítnutý pár se nesmí vrátit do fronty: %', v_r;
  END IF;
  SELECT count(*) FILTER (WHERE state = 'proposed') INTO v_stav FROM public.twin_external_refs
   WHERE twin_id = v_twin2 AND source = '${UCTY}';
  IF v_stav <> '0' THEN RAISE EXCEPTION 'po zamítnutí nesmí u dvojčete zůstat návrh (%)', v_stav; END IF;

  -- 4. potvrzení JE lidské: stroj (service_role) ho neprovede, správce ano
  SELECT r.id INTO v_ref FROM public.twin_external_refs r
   WHERE r.twin_id = v_twin AND r.source = '${UCTY}' AND r.state = 'proposed' LIMIT 1;
  -- ⛔ Stroj = role služby BEZ člověka za ní. Claim sub se musí vyprázdnit: broker
  -- posílá jen {"role":"service_role"}, kdežto ve fixture zůstal sub správce
  -- z předchozího kroku a stráž (is_admin_or_staff + auth.uid()) by ho pustila.
  -- Takhle test měří skutečný tvar volání stroje, ne pozůstatek po sobě samém.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN PERFORM public.twin_identity_confirm_binding(v_ref);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'service_role nesmí potvrdit vazbu — ratifikace je lidská'; END IF;
  IF public.twin_identity_resolve('${UCTY}', 'u-jana') IS NOT NULL THEN
    RAISE EXCEPTION 'po odmítnutém strojovém potvrzení nesmí vazba existovat';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_admin)::text, true);
  PERFORM public.twin_identity_confirm_binding(v_ref);
  IF public.twin_identity_resolve('${UCTY}', 'u-jana') IS DISTINCT FROM v_twin THEN
    RAISE EXCEPTION 'po lidském potvrzení musí resolve vazbu najít';
  END IF;

  -- 4b. PŘEVZETÍ KLÍČE JE VIDĚT: týž účet navržený jinému dvojčeti nese conflict
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_r := public.twin_identity_propose_match(v_twin2, '${UCTY}', 'u-jana', 'primary_id', 'rule:email', 0.7);
  IF v_r->>'state' <> 'proposed' THEN RAISE EXCEPTION 'návrh na cizí klíč se má založit k rozhodnutí: %', v_r; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_admin)::text, true);
  v_items := public.twin_identity_list_unmatched(NULL, 200);
  IF NOT (v_items @> jsonb_build_array(jsonb_build_object('twin_id', v_twin2, 'source_key', 'u-jana', 'conflict', true))) THEN
    RAISE EXCEPTION 'fronta musí u převzetí klíče ukázat conflict=true: %', v_items;
  END IF;
  IF NOT ((public.get_twin_identity_queue('{}'::jsonb)->'data'->'items')::text LIKE '%"key": "conflict"%'
       OR (public.get_twin_identity_queue('{}'::jsonb)->'data'->'items')::text LIKE '%"key":"conflict"%') THEN
    RAISE EXCEPTION 'blok fronty musí nést pole conflict';
  END IF;
  -- a potvrdit takový návrh bez vědomého předání NELZE
  SELECT r.id INTO v_ref FROM public.twin_external_refs r
   WHERE r.twin_id = v_twin2 AND r.source = '${UCTY}' AND r.source_key = 'u-jana' AND r.state = 'proposed' LIMIT 1;
  v_failed := false;
  BEGIN PERFORM public.twin_identity_confirm_binding(v_ref);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'převzetí klíče nesmí projít bez vědomého supersede'; END IF;

  -- 5. bez nároku nic: ani čtení fronty, ani návrh
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"${CIZI}"}', true);
  PERFORM set_config('request.jwt.claim.sub', '${CIZI}', true);
  v_failed := false;
  BEGIN PERFORM public.twin_identity_match_candidates('${CRM}', 'person.email', '${UCTY}', 10);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'frontu k porovnání nesmí číst nikdo bez nároku (jsou v ní e-maily)'; END IF;
  v_failed := false;
  BEGIN PERFORM public.twin_identity_propose_match(v_twin2, '${UCTY}', 'u-kdokoli', 'primary_id', 'rule:email', 0.9);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'navrhovat vazbu nesmí nikdo bez nároku'; END IF;

  RAISE NOTICE 'doporučení identit z ingestu OK';
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});
