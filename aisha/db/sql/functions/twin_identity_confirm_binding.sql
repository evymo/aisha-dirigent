-- ============================================================================
-- Source of Truth: twin_identity_confirm_binding
-- Popis: LIDSKÁ ratifikace navržené vazby — jediná cesta, jak se cross-source
--        vazba stává autoritativní. Výhradně admin/staff s reálným auth.uid()
--        (confirmed_by = audit trail); service_role NEMÁ ratifikovat — import
--        navrhuje, člověk potvrzuje.
--        Drží-li klíč jiné dvojče (předání čipu), potvrzení bez p_supersede
--        selže; s p_supersede=true se starému vlastníku ukončí platnost
--        (valid_to = now(), state zůstává confirmed = historie) a nová vazba
--        se potvrdí — handover bez ztráty historie.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: twin_external_refs.confirmed (bez source_key)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_identity_confirm_binding(
  p_ref_id uuid,
  p_supersede boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reviewer uuid := auth.uid();
  v_ref record;
  v_owner record;
  v_superseded uuid;
BEGIN
  -- Lidská ratifikace: admin/staff s reálnou identitou (NE service_role)
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required (human ratification)';
  END IF;
  IF v_reviewer IS NULL THEN
    RAISE EXCEPTION 'Ratification requires an authenticated reviewer (auth.uid() is null)';
  END IF;

  SELECT r.id, r.twin_id, r.source, r.source_key, r.ref_kind, r.entity_type, r.state
    INTO v_ref
    FROM public.twin_external_refs r WHERE r.id = p_ref_id;
  IF v_ref.id IS NULL THEN
    RAISE EXCEPTION 'binding % not found', p_ref_id;
  END IF;
  IF v_ref.state <> 'proposed' THEN
    RAISE EXCEPTION 'binding % is %, only proposed can be confirmed', p_ref_id, v_ref.state;
  END IF;

  -- Aktivní potvrzený vlastník téhož klíče V RÁMCI DRUHU (2026-09-27: vozidlo 5
  -- a osoba 5 téhož zdroje si klíč neberou — potvrzení osoby dřív spadlo na
  -- „key already confirmed for another twin", protože klíč držel vůz).
  SELECT r.id, r.twin_id INTO v_owner
  FROM public.twin_external_refs r
  WHERE r.source = v_ref.source
    AND r.source_key = v_ref.source_key
    AND r.ref_kind = v_ref.ref_kind
    AND r.entity_type = v_ref.entity_type
    AND r.state = 'confirmed'
    AND r.valid_to IS NULL
  LIMIT 1;

  IF v_owner.id IS NOT NULL THEN
    IF v_owner.twin_id = v_ref.twin_id THEN
      -- Totéž dvojče už klíč drží — návrh je bezpředmětný
      UPDATE public.twin_external_refs
      SET state = 'superseded', updated_at = now()
      WHERE id = p_ref_id;
      RETURN jsonb_build_object('ref_id', v_owner.id, 'state', 'confirmed', 'already', true);
    END IF;
    IF NOT p_supersede THEN
      RAISE EXCEPTION 'key already confirmed for another twin (%) — pass p_supersede => true to hand over', v_owner.twin_id;
    END IF;
    -- Handover: starému vlastníku končí platnost, historie zůstává
    UPDATE public.twin_external_refs
    SET valid_to = now(), updated_at = now()
    WHERE id = v_owner.id;
    v_superseded := v_owner.id;
  END IF;

  UPDATE public.twin_external_refs
  SET state = 'confirmed',
      confirmed_by = v_reviewer,
      confirmed_at = now(),
      valid_from = now(),
      updated_at = now()
  WHERE id = p_ref_id;

  -- Audit log (bez source_key — klíč zdroje může být osobní údaj)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_reviewer,
    'twin_external_refs.confirmed',
    jsonb_build_object(
      'ref_id', p_ref_id,
      'twin_id', v_ref.twin_id,
      'source', v_ref.source,
      'ref_kind', v_ref.ref_kind,
      'superseded_ref_id', v_superseded
    )
  );

  RETURN jsonb_build_object(
    'ref_id', p_ref_id,
    'state', 'confirmed',
    'superseded_ref_id', v_superseded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twin_identity_confirm_binding(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_identity_confirm_binding(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_identity_confirm_binding(uuid, boolean) TO service_role;
