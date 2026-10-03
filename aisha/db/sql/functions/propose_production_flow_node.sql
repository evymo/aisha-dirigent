-- ============================================================================
-- Source of Truth: propose_production_flow_node
-- Popis: Přijme JEDEN návrh uzlu mapy toku od ingestu (flow_map_artifact,
--        kind='node') a založí ho NEAKTIVNÍ. Aktivace je lidský akt
--        v administraci — tahle funkce ji z principu neumí provést.
--
-- PROČ VZNIKLA: ingest mapu toku měří a emituje autonomně
-- (flow_map_export.py), ale artefakt neměl na platformě žádného čtenáře —
-- táž díra, jakou měl workflow_runs_artifact (vyřešena ensure_workflow_run_
-- for_subject). Chybějící sloveso, ne chybějící mašinerie.
--
-- PROČ NE upsert_production_flow_node_admin: guard má
-- `is_admin_or_staff(auth.uid())` a GRANT jen pro authenticated, takže lane
-- běžící jako service_role jím uzel nezaloží. Guard _admin funkce se
-- NEROZŠIŘUJE (návrh musí mít vlastní sloveso) — a hlavně: admin verb umí
-- `p_is_active := true`, což návrh nikdy nesmí. Tady je neaktivita VYNUCENA
-- tvarem INSERTu, ne kázní volajícího.
--
-- CO SE NIKDY NEDĚLÁ:
--   · AKTIVNÍ uzel se nikdy nemění — je to ratifikovaný provoz; nový důkaz
--     z ingestu ho nesmí přepsat ani deaktivovat (vrací already_active).
--   · Neaktivní uzel BEZ metadata.proposal (založil ho člověk ručně) se
--     nechává být (exists_unmanaged) — návrh nesmí přepsat lidskou práci.
--   · node_type se nevaliduje tady: CHECK na tabulce je jediný zdroj pravdy
--     a vadná hodnota selže nahlas per řádek (drain řádek zaloguje, bundle
--     pokračuje).
--
-- IDEMPOTENCE podle node_code (UNIQUE na tabulce): opakovaný drain téhož
-- bundle vrátí existující návrh; nový běh ingestu s čerstvějším měřením
-- návrhu OBNOVÍ důkaz (metadata.proposal.measured) — ratifikátor má vidět
-- poslední stav, ne první.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (service_role + authenticated),
-- vzor ensure_workflow_run_for_subject. Audit: write_audit_journal snese
-- NULL p_user_id (systémový zápis service_role).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.propose_production_flow_node(
  p_node_code text,
  p_node_name text,
  p_node_type text  DEFAULT 'storage',
  p_measured  jsonb DEFAULT '{}'::jsonb,
  p_pair      jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id        uuid;
  v_is_active boolean;
  v_meta      jsonb;
  v_proposal  jsonb;
BEGIN
  IF NOT (public.is_admin_or_staff(auth.uid()) OR public.is_service_role()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin, staff or service role required');
  END IF;

  IF coalesce(btrim(p_node_code), '') = '' OR coalesce(btrim(p_node_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'node_code and node_name are required');
  END IF;

  v_proposal := jsonb_build_object(
    'measured',    coalesce(p_measured, '{}'::jsonb),
    'pair',        p_pair,
    'proposed_by', 'ingest/flow_map',
    'proposed_at', now());

  SELECT id, is_active, coalesce(metadata, '{}'::jsonb)
    INTO v_id, v_is_active, v_meta
  FROM public.production_flow_nodes
  WHERE node_code = p_node_code
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.production_flow_nodes
      (node_code, node_name, node_type, is_active, metadata, created_by)
    VALUES
      (p_node_code, p_node_name, p_node_type,
       false,  -- návrh NIKDY neaktivuje provoz — vynuceno tvarem, ne kázní
       jsonb_build_object('proposal', v_proposal),
       auth.uid())
    RETURNING id INTO v_id;

    PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area        := 'products'::public.journal_area,
      p_details     := NULL,
      p_entity_id   := v_id::text,
      p_entity_type := 'production_flow_node',
      p_new_values  := jsonb_build_object('node_code', p_node_code,
                                          'node_type', p_node_type,
                                          'is_active', false),
      p_old_values  := NULL,
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := format('Ingest proposed flow node %s (inactive, awaiting ratification)',
                              p_node_code),
      p_tags        := ARRAY['ingest', 'flow_tracking', 'proposal'],
      p_user_id     := auth.uid());

    RETURN jsonb_build_object('ok', true, 'node_id', v_id, 'created', true);
  END IF;

  IF v_is_active THEN
    -- Ratifikovaný provoz: důkaz z ingestu ho nemění ani nedeaktivuje.
    RETURN jsonb_build_object('ok', true, 'node_id', v_id, 'already_active', true);
  END IF;

  IF NOT (v_meta ? 'proposal') THEN
    -- Neaktivní, ale založený člověkem: návrh nesmí přepsat lidskou práci.
    RETURN jsonb_build_object('ok', true, 'node_id', v_id, 'exists_unmanaged', true);
  END IF;

  -- Neratifikovaný návrh patří celý ingestu: čerstvé měření smí obnovit
  -- i jméno a typ, ratifikátor má posuzovat poslední stav.
  --
  -- LIDSKÝ VERDIKT ALE PŘEŽIJE MĚŘENÍ. Zamítnutý návrh zůstává zamítnutý:
  -- kdyby ho refresh přepsal, každý další drain by ho vrátil do ratifikační
  -- fronty a člověk by donekonečna rozhodoval o týchž stovkách míst
  -- (fronta v get_flow_node_queue filtruje právě na NEPŘÍTOMNOST verdiktu).
  -- Důkaz se aktualizuje, rozhodnutí se dědí.
  UPDATE public.production_flow_nodes
     SET metadata   = v_meta || jsonb_build_object('proposal',
                        v_proposal || coalesce(
                          jsonb_strip_nulls(jsonb_build_object(
                            'decision',     v_meta->'proposal'->'decision',
                            'decided_by',   v_meta->'proposal'->'decided_by',
                            'decided_at',   v_meta->'proposal'->'decided_at',
                            'decided_note', v_meta->'proposal'->'decided_note')),
                          '{}'::jsonb)),
         node_name  = p_node_name,
         node_type  = p_node_type,
         updated_at = now()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'node_id', v_id, 'refreshed', true,
                            'decision', v_meta->'proposal'->>'decision');
END;
$function$;

REVOKE ALL ON FUNCTION public.propose_production_flow_node(text, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_production_flow_node(text, text, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.propose_production_flow_node(text, text, text, jsonb, jsonb) TO authenticated;
