-- ============================================================================
-- Source of Truth: twin_identity_propose_binding
-- Popis: NÁVRH cross-source vazby identity (řidič↔platformní user, čip↔osoba,
--        osoba↔ERP zaměstnanec…). Zdroj/pravidlo navrhuje S EVIDENCÍ
--        (proposed_by, confidence) — nikdy nic nepotvrzuje samo: potvrzení
--        je výhradně lidské (twin_identity_confirm_binding).
--        Idempotence: existující potvrzená vazba téhož dvojčete → vrací ji
--        beze změny; existující shodný návrh → vrací jej (žádné duplicity
--        ve frontě). Návrh na klíč potvrzený JINÉMU dvojčeti se založí
--        (conflict=true) — jde do review, NIKDY nepřepisuje potvrzené.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: twin_external_refs.proposed (bez source_key)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_identity_propose_binding(
  p_twin_id uuid,
  p_source text,
  p_source_key text,
  p_ref_kind text,
  p_proposed_by text,
  p_confidence numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_ref uuid;
  v_owner uuid;
  v_conflict boolean := false;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_twin_id IS NULL THEN
    RAISE EXCEPTION 'p_twin_id must not be null';
  END IF;
  IF p_source IS NULL OR btrim(p_source) = '' THEN
    RAISE EXCEPTION 'p_source must not be blank';
  END IF;
  IF p_source_key IS NULL OR btrim(p_source_key) = '' THEN
    RAISE EXCEPTION 'p_source_key must not be blank';
  END IF;
  -- ⛔ JEDNA SKUTEČNOST, JEDNA IDENTITA (2026-09-19). Zdroj pohlcený jiným
  -- (registr: neaktivní + superseded_by) se zapisuje pod toho, kdo ho pohltil.
  -- Bez toho přehrání starého balíčku s historickým jménem (`aisha-local-ingest`)
  -- nenajde existující twin a založí duplikát — 30. 8. to bylo 839 firem.
  -- Viz canonical_ingest_source.
  p_source := public.canonical_ingest_source(p_source);
  IF p_ref_kind IS NULL OR btrim(p_ref_kind) = '' THEN
    RAISE EXCEPTION 'p_ref_kind must not be blank';
  END IF;
  IF p_proposed_by IS NULL OR btrim(p_proposed_by) = '' THEN
    RAISE EXCEPTION 'p_proposed_by must not be blank';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_entities t WHERE t.id = p_twin_id) THEN
    RAISE EXCEPTION 'twin % not found', p_twin_id;
  END IF;

  -- Aktivní potvrzený vlastník klíče V RÁMCI DRUHU navrhovaného dvojčete
  -- (2026-09-27: vozidlo 5 a osoba 5 téhož zdroje jsou dvě různé vazby —
  -- dřív se návrh pro osobu tiše přeskočil jako „konflikt s vozidlem").
  SELECT r.id, r.twin_id INTO v_ref, v_owner
  FROM public.twin_external_refs r
  WHERE r.source = p_source
    AND r.source_key = p_source_key
    AND r.ref_kind = p_ref_kind
    AND r.entity_type = (SELECT t.entity_type FROM public.twin_entities t WHERE t.id = p_twin_id)
    AND r.state = 'confirmed'
    AND r.valid_to IS NULL
  LIMIT 1;

  IF v_owner IS NOT NULL AND v_owner = p_twin_id THEN
    -- Už potvrzeno témuž dvojčeti — idempotentně vracíme, nic se nemění
    RETURN jsonb_build_object('ref_id', v_ref, 'state', 'confirmed', 'already', true);
  END IF;
  v_conflict := v_owner IS NOT NULL;  -- klíč drží jiné dvojče → návrh jde do review

  -- Shodný čekající návrh — idempotentně vracíme (fronta bez duplicit)
  SELECT r.id INTO v_ref
  FROM public.twin_external_refs r
  WHERE r.twin_id = p_twin_id
    AND r.source = p_source
    AND r.source_key = p_source_key
    AND r.ref_kind = p_ref_kind
    AND r.state = 'proposed'
  LIMIT 1;

  IF v_ref IS NOT NULL THEN
    RETURN jsonb_build_object('ref_id', v_ref, 'state', 'proposed', 'already', true, 'conflict', v_conflict);
  END IF;

  INSERT INTO public.twin_external_refs (
    twin_id, source, source_key, ref_kind, state, proposed_by, confidence, note
  )
  VALUES (
    p_twin_id, p_source, p_source_key, p_ref_kind, 'proposed', p_proposed_by, p_confidence, p_note
  )
  RETURNING id INTO v_ref;

  -- Audit log (bez source_key — klíč zdroje může být osobní údaj)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'twin_external_refs.proposed',
    jsonb_build_object(
      'ref_id', v_ref,
      'twin_id', p_twin_id,
      'source', p_source,
      'ref_kind', p_ref_kind,
      'proposed_by', p_proposed_by,
      'conflict', v_conflict
    )
  );

  RETURN jsonb_build_object('ref_id', v_ref, 'state', 'proposed', 'already', false, 'conflict', v_conflict);
END;
$$;

REVOKE ALL ON FUNCTION public.twin_identity_propose_binding(uuid, text, text, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_identity_propose_binding(uuid, text, text, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_identity_propose_binding(uuid, text, text, text, text, numeric, text) TO service_role;
