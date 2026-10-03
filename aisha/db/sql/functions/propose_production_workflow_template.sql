-- ============================================================================
-- Source of Truth: propose_production_workflow_template
-- Popis: Přijme CELOU mapu toku od ingestu (flow_map_artifact) a založí z ní
--        JEDNU NAVRŽENOU verzi výrobní šablony — neaktivní a nikdy výchozí.
--        Ratifikace je lidský akt v administraci; tahle funkce ji z principu
--        neumí provést.
--
-- PROČ CELOU MAPU A NE HRANU PO HRANĚ: uzel bez hran je bod bez toho, co mezi
-- ním teče, a hrana bez uzlů je šipka odnikud nikam. `propose_production_flow_node`
-- (PR #37) uzavřel jen třetinu rodiny `flow_map_proposal` — z běhu nad 36 724
-- jízdami dorazilo 435 uzlů, ale 1 665 hran a 141 podpisů pohybu nemělo
-- konzumenta. Hledat jim vlastní tabulku by ale znamenalo postavit druhý graf
-- VEDLE výroby:
--   · production_flow_records je pohyb LÁTKY (substance_id, volume_l,
--     concentration_pct — vše NOT NULL). Pozorovaný přechod A→B objem ani
--     koncentraci nemá; doplnit je = vymyslet si data.
--   · production_flow_nodes nemá pro vazbu sloupec.
--   · flowboard_graphs je uživatelsky kreslený graf a vyžaduje auth.uid().
-- Hrana tedy nemá vlastní domov a nemá ho mít. Patří DOVNITŘ návrhu procesu:
--   uzly    → workflow_steps (kroky, čím se prochází)
--   hrany   → workflow_data.transitions (přechody mezi kroky)
--   podpisy → workflow_data.movers (jakou roli hraje který stroj: rover/shuttle)
-- Tím se měření sváže s tím, co už existuje, místo aby vedle toho žilo zvlášť.
--
-- A ZAVÍRÁ TO SMYČKU: ratifikovaná šablona pohání
-- ensure_workflow_run_for_subject → production_batches →
-- production_workflow_steps → get_workflow_my_steps_block, tedy přesně to, co
-- řidič potvrzuje na pásce. Od pozorované jízdy k potvrzení v telefonu vede
-- jedna cesta, ne dvě.
--
-- PROČ NE create/update_production_workflow_template*_admin: oba mají guard
-- `is_admin_or_staff(auth.uid())`, takže lane běžící jako service_role jimi
-- nezaloží nic — a hlavně umí `is_active := true`, což návrh nikdy nesmí.
-- Guard _admin funkcí se NEROZŠIŘUJE; návrh musí mít vlastní sloveso, kde je
-- neaktivita vynucena TVAREM INSERTu, ne kázní volajícího.
--
-- CO SE NIKDY NEDĚLÁ (shodně s propose_production_flow_node):
--   · AKTIVNÍ šablona se nikdy nemění — je to ratifikovaný proces, podle
--     kterého se možná právě teď potvrzují dodávky (already_active).
--   · Neaktivní šablona BEZ metadata.proposal ve workflow_data (založil ji
--     člověk) se nechává být (exists_unmanaged) — návrh nesmí přepsat ruční práci.
--   · is_default se nenastavuje NIKDY; výchozí proces vybírá člověk.
--
-- IDEMPOTENCE podle `name` (deterministické z p_source_key): opakovaný drain
-- téhož balíčku vrátí existující návrh; čerstvější běh ingestu důkaz OBNOVÍ
-- a přidá VERZI, takže ratifikátor vidí poslední stav a zároveň historii toho,
-- jak se proces měřením vyvíjel (production_workflow_template_versions je
-- právě na to — variabilní, verzovatelné flow).
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (service_role + authenticated).
-- Audit: write_audit_journal snese NULL p_user_id (systémový zápis).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.propose_production_workflow_template(
  p_source_key  text,
  p_steps       jsonb DEFAULT '[]'::jsonb,
  p_transitions jsonb DEFAULT '[]'::jsonb,
  p_movers      jsonb DEFAULT '[]'::jsonb,
  p_measured    jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name      text;
  v_id        uuid;
  v_is_active boolean;
  v_data      jsonb;
  v_proposal  jsonb;
  v_payload   jsonb;
  v_version   integer;
BEGIN
  IF NOT (public.is_admin_or_staff(auth.uid()) OR public.is_service_role()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin, staff or service role required');
  END IF;

  IF coalesce(btrim(p_source_key), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source_key is required');
  END IF;

  -- Prázdný návrh se NEZAKLÁDÁ. Šablona bez kroků by v administraci vypadala
  -- jako hotová práce, ke které se jen nikdo nedostal — a ratifikovat by nešlo
  -- co. Mlčení o prázdné mapě je horší než odmítnutí.
  IF jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'steps must be a non-empty array');
  END IF;

  v_name := 'Ingest: ' || p_source_key;

  v_proposal := jsonb_build_object(
    'measured',    coalesce(p_measured, '{}'::jsonb),
    'source_key',  p_source_key,
    'proposed_by', 'ingest/flow_map',
    'proposed_at', now());

  -- Přechody a role strojů jsou SOUČÁST návrhu procesu, ne vedlejší tabulka.
  v_payload := jsonb_build_object(
    'transitions', coalesce(p_transitions, '[]'::jsonb),
    'movers',      coalesce(p_movers, '[]'::jsonb),
    'proposal',    v_proposal);

  SELECT id, coalesce(is_active, false), coalesce(workflow_data, '{}'::jsonb)
    INTO v_id, v_is_active, v_data
  FROM public.production_workflow_templates
  WHERE name = v_name
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.production_workflow_templates
      (name, description, steps, workflow_data, is_active, is_default, created_by)
    SELECT
      v_name,
      format('Návrh procesu z pozorování ingestu (%s kroků, %s přechodů, %s strojů) — NERATIFIKOVÁNO',
             jsonb_array_length(p_steps),
             jsonb_array_length(coalesce(p_transitions, '[]'::jsonb)),
             jsonb_array_length(coalesce(p_movers, '[]'::jsonb))),
      p_steps,
      v_payload,
      false,  -- návrh NIKDY neaktivuje proces — vynuceno tvarem, ne kázní
      false,  -- a nikdy se nestane výchozím
      auth.uid()
    RETURNING id INTO v_id;

    INSERT INTO public.production_workflow_template_versions
      (template_id, version_number, version_label, workflow_data, workflow_steps,
       change_summary, created_by)
    VALUES
      (v_id, 1, 'ingest-1', v_payload, p_steps,
       'První návrh procesu z mapy toku ingestu', auth.uid())
    RETURNING version_number INTO v_version;

    PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area        := 'products'::public.journal_area,
      p_details     := NULL,
      p_entity_id   := v_id::text,
      p_entity_type := 'production_workflow_template',
      p_new_values  := jsonb_build_object('name', v_name, 'is_active', false,
                                          'steps', jsonb_array_length(p_steps)),
      p_old_values  := NULL,
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := format('Ingest proposed process %s (inactive, awaiting ratification)', v_name),
      p_tags        := ARRAY['ingest', 'flow_tracking', 'proposal'],
      p_user_id     := auth.uid());

    RETURN jsonb_build_object('ok', true, 'template_id', v_id, 'created', true,
                              'version', v_version);
  END IF;

  IF v_is_active THEN
    -- Ratifikovaný proces: možná podle něj právě teď běží dodávky.
    RETURN jsonb_build_object('ok', true, 'template_id', v_id, 'already_active', true);
  END IF;

  IF NOT (v_data ? 'proposal') THEN
    -- Neaktivní, ale založená člověkem: návrh nesmí přepsat lidskou práci.
    RETURN jsonb_build_object('ok', true, 'template_id', v_id, 'exists_unmanaged', true);
  END IF;

  -- Neratifikovaný návrh patří celý ingestu. Čerstvé měření ho OBNOVÍ a přidá
  -- verzi — ratifikátor vidí poslední stav i to, jak se proces měřením vyvíjel.
  SELECT coalesce(max(version_number), 0) + 1 INTO v_version
  FROM public.production_workflow_template_versions WHERE template_id = v_id;

  UPDATE public.production_workflow_templates
     SET steps         = p_steps,
         workflow_data = v_data || v_payload,
         description   = format('Návrh procesu z pozorování ingestu (%s kroků, %s přechodů, %s strojů) — NERATIFIKOVÁNO',
                                jsonb_array_length(p_steps),
                                jsonb_array_length(coalesce(p_transitions, '[]'::jsonb)),
                                jsonb_array_length(coalesce(p_movers, '[]'::jsonb))),
         updated_at    = now()
   WHERE id = v_id;

  INSERT INTO public.production_workflow_template_versions
    (template_id, version_number, version_label, workflow_data, workflow_steps,
     change_summary, created_by)
  VALUES
    (v_id, v_version, 'ingest-' || v_version, v_payload, p_steps,
     'Obnovený návrh z čerstvějšího měření ingestu', auth.uid());

  RETURN jsonb_build_object('ok', true, 'template_id', v_id, 'refreshed', true,
                            'version', v_version);
END;
$function$;

REVOKE ALL ON FUNCTION public.propose_production_workflow_template(text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_production_workflow_template(text, jsonb, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.propose_production_workflow_template(text, jsonb, jsonb, jsonb, jsonb) TO authenticated;
