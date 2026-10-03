-- ============================================================================
-- Source of Truth: twin_upsert_entity_audited
-- Popis: Idempotentní vstupní sloveso adaptérů: „tahle entita existuje
--        ve zdroji pod tímhle klíčem". Resolvne potvrzenou primární identitu
--        (source, source_key, ref_kind='primary_id'); existuje-li, jen
--        aktualizuje label/status/metadata dvojčete. Jinak založí dvojče
--        + POTVRZENOU primární ref (confirmed_by NULL = systémové potvrzení:
--        identita ve VLASTNÍM zdroji nepotřebuje lidskou ratifikaci — ta je
--        pro cross-source vazby přes twin_identity_*_binding).
--        Entity se nikdy nemažou — deaktivace přes p_status='inactive'.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: twin_entities.upsert (bez source_key — klíč může být osobní údaj)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_upsert_entity_audited(
  p_entity_type text,
  p_source text,
  p_source_key text,
  p_label text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588):
  -- COALESCEs to false, so the deny-guard below fails CLOSED.
  v_is_service boolean := public.is_service_role();
  v_twin uuid;
  v_created boolean := false;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_entity_type IS NULL OR btrim(p_entity_type) = '' THEN
    RAISE EXCEPTION 'p_entity_type must not be blank';
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
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'inactive', 'archived') THEN
    RAISE EXCEPTION 'p_status must be active/inactive/archived';
  END IF;

  -- Resolve přes potvrzenou, časově platnou primární identitu TÉHOŽ DRUHU.
  -- ⛔ 2026-09-27: bez druhu by osoba 5 našla VOZIDLO 5 téhož zdroje a níž by
  -- mu přepsala jméno a metadata (Eurowag: monitoredObjectId × driver id).
  SELECT r.twin_id INTO v_twin
  FROM public.twin_external_refs r
  WHERE r.source = p_source
    AND r.source_key = p_source_key
    AND r.ref_kind = 'primary_id'
    AND r.entity_type = p_entity_type
    AND r.state = 'confirmed'
    AND r.valid_to IS NULL
  LIMIT 1;

  IF v_twin IS NULL THEN
    INSERT INTO public.twin_entities (entity_type, label, status, metadata)
    VALUES (
      p_entity_type,
      p_label,
      COALESCE(p_status, 'active'),
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_twin;

    -- Primární identita vlastního zdroje: potvrzeno systémem (confirmed_by NULL)
    INSERT INTO public.twin_external_refs (
      twin_id, source, source_key, ref_kind,
      state, proposed_by, confirmed_by, confirmed_at
    )
    VALUES (
      v_twin, p_source, p_source_key, 'primary_id',
      'confirmed', 'import', NULL, now()
    );

    v_created := true;
  ELSE
    UPDATE public.twin_entities SET
      -- ⛔ JMÉNO ZVOLENÉ ČLOVĚKEM SE NEPŘEPISUJE (2026-09-23). Po sjednocení osoby
      --    (hr_sjednot_osobu_admin) vede na jeden twin víc klíčů zdroje („KOŽUŠNÍK",
      --    „p. Kožušník") a každé doručení by jméno přepsalo zápisem, který přišel
      --    naposled. `label_hr` = jméno určil člověk, ingest ho jen doplňuje jinde.
      label      = CASE WHEN COALESCE(metadata, '{}'::jsonb) ? 'label_hr' THEN label
                        ELSE COALESCE(p_label, label) END,
      status     = COALESCE(p_status, status),
      -- ⛔ ZNAČKY ROZHODNUTÍ PŘEŽIJÍ NÁHRADU METADAT: bez nich by rozhodnutí
      --    nešlo vrátit (revert_twin_decision_admin je hledá) a zámek jména by
      --    zmizel s prvním balíkem. Ingest posílá metadata celá, ne rozdíl.
      metadata   = CASE WHEN p_metadata IS NULL THEN metadata
                        ELSE p_metadata || jsonb_strip_nulls(jsonb_build_object(
                               'label_hr', metadata -> 'label_hr',
                               'label_hr_rozhodnutim', metadata -> 'label_hr_rozhodnutim',
                               'archivovano_rozhodnutim', metadata -> 'archivovano_rozhodnutim',
                               'sjednoceno_do', metadata -> 'sjednoceno_do')) END,
      updated_at = now()
    WHERE id = v_twin;
  END IF;

  -- Audit log (bez source_key — klíč zdroje může být osobní údaj)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'twin_entities.upsert',
    jsonb_build_object(
      'twin_id', v_twin,
      'entity_type', p_entity_type,
      'source', p_source,
      'created', v_created
    )
  );

  RETURN jsonb_build_object('twin_id', v_twin, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.twin_upsert_entity_audited(text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_upsert_entity_audited(text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_upsert_entity_audited(text, text, text, text, text, jsonb) TO service_role;
