-- ============================================================================
-- Source of Truth: revert_twin_decision_admin
-- Popis: VRÁTÍ jedno rozhodnutí nad twiny (podle decision_id z audit_journal):
--        twiny, vazby i zdroj vazeb obnoví do stavu PŘED rozhodnutím, s důvodem
--        a stopou, kdo vracel.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⭐ VRACÍ PŘESNĚ, NE ODHADEM. Rozhodnutí si uložilo stav PŘED sebou u každého
--    twinu (`pred_status`) a každé ukončené vazby (`pred_state`) a seznam
--    převedených vazeb. Vrací se jen řádky, které jsou pořád v tom stavu, do
--    kterého je rozhodnutí dalo (twin nese `archivovano_rozhodnutim` = toto id;
--    vazba je pořád ukončená / pořád pod kanonickým zdrojem). Řádek, se kterým
--    od té doby někdo pracoval, se nepřepíše — počítá se jako
--    `preskoceno_zmenene` a vrácení to řekne.
--
-- ⛔ Obnovení potvrzené vazby by mohlo narazit na jedinečnost vlastníka klíče
--    (source, source_key, ref_kind), kdyby klíč mezitím potvrdil jiný twin.
--    Takovou vazbu vrácení přeskočí (`preskoceno_zmenene`), nespadne celé.
--
-- ⛔ audit_journal je neměnný: vrácení se ZAPISUJE jako nový řádek
--    `twin.decision_reverted` s entity_id = decision_id. Dvojí vrácení se odmítne.
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true).
--
-- Typy rozhodnutí:
--   · twin.absorbed_source_resolved (resolve_absorbed_ingest_source_admin),
--   · twin.person_unified (hr_sjednot_osobu_admin, 2026-09-23): úlomky zpět
--     z archivu, přesunuté vazby zpět k úlomkům, ukončené obnovit, ČEKAJÍCÍ
--     úkoly zpět (hotové se nevracejí — tu práci už někdo odvedl), a odemknout
--     jméno kanonu, pokud ho zamklo PRÁVĚ toto rozhodnutí.
-- Jiný typ se odmítne pojmenovaně — vrácení, které neví, co vrací, je horší než žádné.
--
-- Kontrakt: (uuid, text, boolean) ->
--   jsonb {ok, dry_run, decision_id, akce, twinu, vazeb_obnoveno, vazeb_vraceno_zdroji,
--          preskoceno_zmenene}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.revert_twin_decision_admin(
  p_decision_id uuid,
  p_reason      text,
  p_dry_run     boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rozhodnuti public.audit_journal%ROWTYPE;
  v_zdroj      text;
  v_kanon      text;
  v_twinu      integer := 0;
  v_vazeb      integer := 0;
  v_zdroji     integer := 0;
  v_celkem     integer := 0;
  v_kanon_id   uuid;
  v_zpet       integer := 0;
  v_kroku      integer := 0;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff(auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nedostatečné oprávnění');
  END IF;
  IF p_decision_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_decision_id je povinné');
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'důvod (p_reason) je povinný — vrácení bez důvodu nejde doložit');
  END IF;

  SELECT * INTO v_rozhodnuti FROM public.audit_journal
   WHERE id = p_decision_id AND entity_type = 'twin_decision';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rozhodnutí nenalezeno');
  END IF;
  IF v_rozhodnuti.action NOT IN ('twin.absorbed_source_resolved', 'twin.person_unified') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('typ rozhodnutí %s zatím vrátit neumím', v_rozhodnuti.action));
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_journal
              WHERE action = 'twin.decision_reverted' AND entity_id = p_decision_id::text) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rozhodnutí už bylo vráceno');
  END IF;

  -- ── SJEDNOCENÍ OSOBY (hr_sjednot_osobu_admin) ─────────────────────────────
  -- Vrací se jen řádky, které jsou pořád tam, kam je rozhodnutí dalo; ostatní
  -- (někdo s nimi mezitím pracoval) se přeskočí a vrácení to spočítá.
  IF v_rozhodnuti.action = 'twin.person_unified' THEN
    v_kanon_id := (v_rozhodnuti.details ->> 'kanon')::uuid;
    v_celkem := jsonb_array_length(coalesce(v_rozhodnuti.details -> 'archivovane_twiny', '[]'::jsonb))
              + jsonb_array_length(coalesce(v_rozhodnuti.details -> 'presunute_vazby', '[]'::jsonb))
              + jsonb_array_length(coalesce(v_rozhodnuti.details -> 'nahrazene_vazby', '[]'::jsonb))
              + jsonb_array_length(coalesce(v_rozhodnuti.details -> 'prepojene_kroky', '[]'::jsonb));
    IF p_dry_run THEN
      SELECT count(*) INTO v_twinu
        FROM public.twin_entities e
        JOIN jsonb_to_recordset(v_rozhodnuti.details -> 'archivovane_twiny') AS x(id uuid, pred_status text) ON x.id = e.id
       WHERE e.status = 'archived' AND e.metadata ->> 'archivovano_rozhodnutim' = p_decision_id::text;
      SELECT count(*) INTO v_zpet
        FROM public.twin_external_refs r
        JOIN jsonb_to_recordset(v_rozhodnuti.details -> 'presunute_vazby') AS x(id uuid, pred_twin_id uuid) ON x.id = r.id
       WHERE r.twin_id = v_kanon_id AND r.valid_to IS NULL;
      SELECT count(*) INTO v_vazeb
        FROM public.twin_external_refs r
        JOIN jsonb_to_recordset(v_rozhodnuti.details -> 'nahrazene_vazby') AS x(id uuid, pred_state text) ON x.id = r.id
       WHERE r.state = 'superseded' AND r.valid_to IS NOT NULL;
      SELECT count(*) INTO v_kroku
        FROM public.production_workflow_steps st
        JOIN jsonb_to_recordset(v_rozhodnuti.details -> 'prepojene_kroky') AS x(id uuid, pred_twin_id text) ON x.id = st.id
       WHERE st.status = 'pending' AND st.input_data ->> 'authorized_twin_id' = v_kanon_id::text;
      RETURN jsonb_build_object('ok', true, 'dry_run', true, 'decision_id', p_decision_id,
                                'akce', v_rozhodnuti.action, 'twinu', v_twinu,
                                'vazeb_zpet', v_zpet, 'vazeb_obnoveno', v_vazeb, 'kroku_zpet', v_kroku,
                                'preskoceno_zmenene', v_celkem - v_twinu - v_zpet - v_vazeb - v_kroku);
    END IF;

    UPDATE public.twin_entities e
       SET status = x.pred_status,
           metadata = e.metadata - 'archivovano_rozhodnutim' - 'sjednoceno_do',
           updated_at = now()
      FROM jsonb_to_recordset(v_rozhodnuti.details -> 'archivovane_twiny') AS x(id uuid, pred_status text)
     WHERE e.id = x.id AND e.status = 'archived'
       AND e.metadata ->> 'archivovano_rozhodnutim' = p_decision_id::text;
    GET DIAGNOSTICS v_twinu = ROW_COUNT;

    UPDATE public.twin_external_refs r
       SET twin_id = x.pred_twin_id, updated_at = now()
      FROM jsonb_to_recordset(v_rozhodnuti.details -> 'presunute_vazby') AS x(id uuid, pred_twin_id uuid)
     WHERE r.id = x.id AND r.twin_id = v_kanon_id AND r.valid_to IS NULL;
    GET DIAGNOSTICS v_zpet = ROW_COUNT;

    UPDATE public.twin_external_refs r
       SET state = x.pred_state, valid_to = NULL, updated_at = now()
      FROM jsonb_to_recordset(v_rozhodnuti.details -> 'nahrazene_vazby') AS x(id uuid, pred_state text)
     WHERE r.id = x.id AND r.state = 'superseded' AND r.valid_to IS NOT NULL;
    GET DIAGNOSTICS v_vazeb = ROW_COUNT;

    UPDATE public.production_workflow_steps st
       SET input_data = jsonb_set(st.input_data, '{authorized_twin_id}', to_jsonb(x.pred_twin_id))
      FROM jsonb_to_recordset(v_rozhodnuti.details -> 'prepojene_kroky') AS x(id uuid, pred_twin_id text)
     WHERE st.id = x.id AND st.status = 'pending'
       AND st.input_data ->> 'authorized_twin_id' = v_kanon_id::text;
    GET DIAGNOSTICS v_kroku = ROW_COUNT;

    UPDATE public.twin_entities e
       SET metadata = e.metadata - 'label_hr' - 'label_hr_rozhodnutim', updated_at = now()
     WHERE e.id = v_kanon_id AND e.metadata ->> 'label_hr_rozhodnutim' = p_decision_id::text;

    INSERT INTO public.audit_journal (user_id, action, action_type, area, entity_type, entity_id,
                                      summary, details)
    VALUES (auth.uid(), 'twin.decision_reverted', 'update', 'twin',
            'twin_decision_revert', p_decision_id::text,
            format('Vráceno sjednocení osoby %s: %s úlomků, %s vazeb zpět, %s obnoveno, %s úkolů zpět — %s',
                   p_decision_id, v_twinu, v_zpet, v_vazeb, v_kroku, p_reason),
            jsonb_build_object('decision_id', p_decision_id, 'akce', v_rozhodnuti.action,
                               'twinu', v_twinu, 'vazeb_zpet', v_zpet, 'vazeb_obnoveno', v_vazeb,
                               'kroku_zpet', v_kroku,
                               'preskoceno_zmenene', v_celkem - v_twinu - v_zpet - v_vazeb - v_kroku,
                               'duvod', p_reason));

    RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', p_decision_id,
                              'akce', v_rozhodnuti.action, 'twinu', v_twinu,
                              'vazeb_zpet', v_zpet, 'vazeb_obnoveno', v_vazeb, 'kroku_zpet', v_kroku,
                              'preskoceno_zmenene', v_celkem - v_twinu - v_zpet - v_vazeb - v_kroku);
  END IF;

  v_zdroj := v_rozhodnuti.details ->> 'zdroj';
  v_kanon := v_rozhodnuti.details ->> 'kanon';
  v_celkem := jsonb_array_length(coalesce(v_rozhodnuti.details -> 'archivovane_twiny', '[]'::jsonb))
            + jsonb_array_length(coalesce(v_rozhodnuti.details -> 'nahrazene_vazby', '[]'::jsonb))
            + jsonb_array_length(coalesce(v_rozhodnuti.details -> 'prevedene_vazby', '[]'::jsonb));

  IF p_dry_run THEN
    SELECT count(*) INTO v_twinu
      FROM public.twin_entities e
      JOIN jsonb_to_recordset(v_rozhodnuti.details -> 'archivovane_twiny') AS x(id uuid, pred_status text) ON x.id = e.id
     WHERE e.status = 'archived' AND e.metadata ->> 'archivovano_rozhodnutim' = p_decision_id::text;
    SELECT count(*) INTO v_vazeb
      FROM public.twin_external_refs r
      JOIN jsonb_to_recordset(v_rozhodnuti.details -> 'nahrazene_vazby') AS x(id uuid, pred_state text) ON x.id = r.id
     WHERE r.state = 'superseded' AND r.valid_to IS NOT NULL
       AND NOT (x.pred_state = 'confirmed' AND EXISTS (
             SELECT 1 FROM public.twin_external_refs o
              WHERE o.source = r.source AND o.source_key = r.source_key AND o.ref_kind = r.ref_kind
                AND o.entity_type = r.entity_type
                AND o.state = 'confirmed' AND o.valid_to IS NULL AND o.id <> r.id));
    SELECT count(*) INTO v_zdroji
      FROM public.twin_external_refs r
     WHERE r.id IN (SELECT (jsonb_array_elements_text(v_rozhodnuti.details -> 'prevedene_vazby'))::uuid)
       AND r.source = v_kanon AND r.valid_to IS NULL;
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'decision_id', p_decision_id,
                              'akce', v_rozhodnuti.action, 'twinu', v_twinu,
                              'vazeb_obnoveno', v_vazeb, 'vazeb_vraceno_zdroji', v_zdroji,
                              'preskoceno_zmenene', v_celkem - v_twinu - v_vazeb - v_zdroji);
  END IF;

  UPDATE public.twin_entities e
     SET status = x.pred_status,
         metadata = e.metadata - 'archivovano_rozhodnutim',
         updated_at = now()
    FROM jsonb_to_recordset(v_rozhodnuti.details -> 'archivovane_twiny') AS x(id uuid, pred_status text)
   WHERE e.id = x.id
     AND e.status = 'archived'
     AND e.metadata ->> 'archivovano_rozhodnutim' = p_decision_id::text;
  GET DIAGNOSTICS v_twinu = ROW_COUNT;

  UPDATE public.twin_external_refs r
     SET state = x.pred_state, valid_to = NULL, updated_at = now()
    FROM jsonb_to_recordset(v_rozhodnuti.details -> 'nahrazene_vazby') AS x(id uuid, pred_state text)
   WHERE r.id = x.id
     AND r.state = 'superseded' AND r.valid_to IS NOT NULL
     AND NOT (x.pred_state = 'confirmed' AND EXISTS (
           SELECT 1 FROM public.twin_external_refs o
            WHERE o.source = r.source AND o.source_key = r.source_key AND o.ref_kind = r.ref_kind
              AND o.entity_type = r.entity_type
              AND o.state = 'confirmed' AND o.valid_to IS NULL AND o.id <> r.id));
  GET DIAGNOSTICS v_vazeb = ROW_COUNT;

  UPDATE public.twin_external_refs r
     SET source = v_zdroj, updated_at = now()
   WHERE r.id IN (SELECT (jsonb_array_elements_text(v_rozhodnuti.details -> 'prevedene_vazby'))::uuid)
     AND r.source = v_kanon AND r.valid_to IS NULL;
  GET DIAGNOSTICS v_zdroji = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details)
  VALUES (auth.uid(), 'twin.decision_reverted', 'update', 'twin',
          'twin_decision_revert', p_decision_id::text,
          format('Vráceno rozhodnutí %s: %s twinů, %s vazeb obnoveno, %s vráceno zdroji %s — %s',
                 p_decision_id, v_twinu, v_vazeb, v_zdroji, v_zdroj, p_reason),
          jsonb_build_object('decision_id', p_decision_id, 'akce', v_rozhodnuti.action,
                             'obnoveno', v_twinu + v_vazeb + v_zdroji,
                             'twinu', v_twinu, 'vazeb_obnoveno', v_vazeb, 'vazeb_vraceno_zdroji', v_zdroji,
                             'preskoceno_zmenene', v_celkem - v_twinu - v_vazeb - v_zdroji,
                             'duvod', p_reason));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', p_decision_id,
                            'akce', v_rozhodnuti.action, 'twinu', v_twinu,
                            'vazeb_obnoveno', v_vazeb, 'vazeb_vraceno_zdroji', v_zdroji,
                            'preskoceno_zmenene', v_celkem - v_twinu - v_vazeb - v_zdroji);
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_twin_decision_admin(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_twin_decision_admin(uuid, text, boolean) TO authenticated, service_role;
