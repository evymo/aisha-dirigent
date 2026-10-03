-- ============================================================================
-- Source of Truth: twin_list_mine
-- Popis: „Moje věci" — twiny přiřazené přihlášenému uživateli. Model majitele
--        (07-17): ŽÁDNÁ role „řidič" — právo = přístup k části (modulu),
--        a uživatel s právem vidí SVOJE věci přes přiřazení twinu:
--        doklad → Ride/Vehicle twin → (account ref) → uživatel.
--        Konvence vazby: twin_external_refs s ref_kind='account' a
--        source_key = uuid platformního uživatele (source = slug IdP,
--        např. 'keycloak' — na slugu NEzáleží, vazba se hledá jen přes
--        ref_kind + source_key = auth.uid()). Vzniká ratifikací
--        (twin_identity_propose/confirm_binding) — nikdy automaticky.
--        Vrací jen potvrzené, časově platné vazby. Přístupné KAŽDÉMU
--        přihlášenému (scoping = vlastní uid, žádná data cizích).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_list_mine(
  p_entity_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_items jsonb;
BEGIN
  -- Scoping na vlastní identitu — bez přihlášení není „moje"
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user required';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'label'), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'twin_id', t.id,
      'entity_type', t.entity_type,
      'label', t.label,
      'status', t.status,
      'bound_since', r.valid_from
    ) AS item
    FROM public.twin_external_refs r
    JOIN public.twin_entities t ON t.id = r.twin_id
    WHERE r.ref_kind = 'account'
      AND r.source_key = v_uid::text
      AND r.state = 'confirmed'
      AND r.valid_from <= now()
      AND (r.valid_to IS NULL OR r.valid_to > now())
      AND (p_entity_type IS NULL OR t.entity_type = p_entity_type)
  ) AS q;

  RETURN v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_list_mine(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_list_mine(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_list_mine(text) TO service_role;
