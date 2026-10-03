-- ============================================================================
-- Source of Truth: twin_identity_reject_binding
-- Popis: Lidské zamítnutí navržené vazby (proposed → rejected). Řádek zůstává
--        jako záznam rozhodnutí (kdo, kdy, proč) — zamítnutý návrh se
--        idempotentně nevrací do fronty (propose týchž hodnot založí nový
--        řádek, reviewer vidí historii zamítnutí).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: twin_external_refs.rejected (bez source_key)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_identity_reject_binding(
  p_ref_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reviewer uuid := auth.uid();
  v_ref record;
BEGIN
  -- Lidské rozhodnutí: admin/staff s reálnou identitou (NE service_role)
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required (human ratification)';
  END IF;
  IF v_reviewer IS NULL THEN
    RAISE EXCEPTION 'Ratification requires an authenticated reviewer (auth.uid() is null)';
  END IF;

  SELECT r.id, r.twin_id, r.source, r.ref_kind, r.state
    INTO v_ref
    FROM public.twin_external_refs r WHERE r.id = p_ref_id;
  IF v_ref.id IS NULL THEN
    RAISE EXCEPTION 'binding % not found', p_ref_id;
  END IF;
  IF v_ref.state <> 'proposed' THEN
    RAISE EXCEPTION 'binding % is %, only proposed can be rejected', p_ref_id, v_ref.state;
  END IF;

  UPDATE public.twin_external_refs
  SET state = 'rejected',
      confirmed_by = v_reviewer,
      confirmed_at = now(),
      note = COALESCE(p_note, note),
      updated_at = now()
  WHERE id = p_ref_id;

  -- Audit log (bez source_key — klíč zdroje může být osobní údaj)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_reviewer,
    'twin_external_refs.rejected',
    jsonb_build_object(
      'ref_id', p_ref_id,
      'twin_id', v_ref.twin_id,
      'source', v_ref.source,
      'ref_kind', v_ref.ref_kind
    )
  );

  RETURN jsonb_build_object('ref_id', p_ref_id, 'state', 'rejected');
END;
$$;

REVOKE ALL ON FUNCTION public.twin_identity_reject_binding(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_identity_reject_binding(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_identity_reject_binding(uuid, text) TO service_role;
