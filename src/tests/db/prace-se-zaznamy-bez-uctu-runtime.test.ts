import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * PRÁCE SE ZÁZNAMY BEZ ÚČTU — real-DB runtime test (throwaway PG).
 *
 * ⛔ NAMĚŘENO 2026-09-15 (demo extranetu): 4 z 5 akcí správy braly
 * target.user_id / user_ids, takže nad dvojčetem bez účtu — kontakt převzatý
 * z Raynetu — padaly 22023. Tvrdí se, že nad TAKOVÝM dvojčetem jde:
 *   · naplánovat follow-up → takt se subjektem dvojče, fronta ukáže jméno dvojčete;
 *   · přidat a odebrat štítek → registr ho ukáže / přestane ukazovat;
 *   · přiřadit správci → hrana assigned_to; opakování nic nezdvojí, přeřazení starou uzavře;
 *   · bez role správce nic z toho.
 * Vše v jedné transakci s ROLLBACK.
 */

const dbAvailable = isPgReachable();
const ZDROJ = `bez-uctu-${process.pid}-${Date.now()}`;

beforeAll(async () => {
  await reportTestCapabilities("Práce se záznamy bez účtu");
});

describe("akce správy nad dvojčetem bez účtu", () => {
  it.skipIf(!dbAvailable)("follow-up, štítek, přiřazení; cizí role nic", () => {
    const run = () =>
      psqlMultiline(`\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_admin uuid; v_admin_twin uuid; v_twin uuid; v_beat uuid; v_r jsonb; v_n int; v_failed boolean; v_tags text[];
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
   WHERE ur.role IN ('admin','staff') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no admin/staff user seeded'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- dvojče bez účtu (jako kontakt z Raynetu) + dvojče správce
  v_twin := (public.twin_upsert_entity_audited('person', '${ZDROJ}', 'R-1', 'Jan Raynet')->>'twin_id')::uuid;
  IF EXISTS (SELECT 1 FROM public.twin_external_refs WHERE twin_id = v_twin AND ref_kind = 'account') THEN
    RAISE EXCEPTION 'fixture: twin must have no account';
  END IF;
  v_admin_twin := public.twin_for_account(v_admin);
  IF v_admin_twin IS NULL THEN
    PERFORM public.twin_ensure_for_account(v_admin, 'Správce', 'person', NULL);
    v_admin_twin := public.twin_for_account(v_admin);
  END IF;
  IF v_admin_twin IS NULL THEN RAISE EXCEPTION 'fixture: admin twin not ensured'; END IF;

  -- 1. follow-up nad dvojčetem bez účtu
  v_beat := public.audience_admin_create_twin_followup(v_twin, now() + interval '2 days', 'zavolat kvůli kurzu', NULL);
  SELECT count(*) INTO v_n FROM public.audience_admin_followup_queue_v q
   WHERE q.task_id = v_beat AND q.subject_type = 'twin' AND q.twin_id = v_twin
     AND q.actor_name = 'Jan Raynet' AND q.actor_user_id IS NULL AND q.assigned_to_user_id = v_admin;
  IF v_n <> 1 THEN RAISE EXCEPTION 'follow-up beat must be queued with twin subject and twin name (n=%)', v_n; END IF;

  -- 2. štítek: přidat obecnou cestou s resource_type 'twin', registr ho ukáže; odebrat
  PERFORM public.audience_tag_resource('zajemce', 'twin', v_twin, 'gray');
  SELECT d.tags INTO v_tags FROM public.audience_admin_twin_directory_v d WHERE d.twin_id = v_twin;
  IF v_tags IS NULL OR NOT ('zajemce' = ANY (v_tags)) THEN RAISE EXCEPTION 'directory must show twin tag (got %)', v_tags; END IF;
  IF public.audience_admin_untag_twin(v_twin, 'zajemce') <> 1 THEN RAISE EXCEPTION 'untag must remove the twin label'; END IF;
  SELECT d.tags INTO v_tags FROM public.audience_admin_twin_directory_v d WHERE d.twin_id = v_twin;
  IF v_tags IS NOT NULL THEN RAISE EXCEPTION 'directory must drop the tag after untag (got %)', v_tags; END IF;

  -- 3. přiřazení: hrana assigned_to; opakování nic nezdvojí
  v_r := public.audience_admin_assign_twin(v_twin, v_admin);
  SELECT count(*) INTO v_n FROM public.twin_relations
   WHERE source_twin_id = v_twin AND target_twin_id = v_admin_twin AND relation_kind = 'assigned_to' AND valid_to IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'assignment must open one assigned_to edge (n=%, r=%)', v_n, v_r; END IF;
  v_r := public.audience_admin_assign_twin(v_twin, v_admin);
  IF NOT coalesce((v_r->>'unchanged')::boolean, false) THEN RAISE EXCEPTION 'repeated assignment must be unchanged (r=%)', v_r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audience_admin_twin_directory_v d
                  WHERE d.twin_id = v_twin AND 'assigned_to' = ANY (d.relation_kinds)) THEN
    RAISE EXCEPTION 'directory must show the assigned_to relation';
  END IF;

  -- 4. vadné vstupy
  v_failed := false;
  BEGIN PERFORM public.audience_admin_create_twin_followup(gen_random_uuid(), now(), 'x', NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown twin must be 22023'; END IF;
  v_failed := false;
  BEGIN PERFORM public.audience_admin_assign_twin(v_twin, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'assignee without twin must be 22023'; END IF;

  -- 5. bez role správce nic
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000d00d"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d00d', true);
  v_failed := false;
  BEGIN PERFORM public.audience_admin_create_twin_followup(v_twin, now(), 'x', NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-admin follow-up must be 42501'; END IF;
  v_failed := false;
  BEGIN PERFORM public.audience_admin_assign_twin(v_twin, v_admin);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-admin assign must be 42501'; END IF;
  v_failed := false;
  BEGIN PERFORM public.audience_admin_untag_twin(v_twin, 'zajemce');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-admin untag must be 42501'; END IF;

  RAISE NOTICE 'práce se záznamy bez účtu OK';
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});
