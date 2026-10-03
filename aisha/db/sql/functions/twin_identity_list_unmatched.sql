-- ============================================================================
-- Source of Truth: twin_identity_list_unmatched
-- Popis: Ratifikační fronta — navržené (proposed) vazby čekající na lidské
--        rozhodnutí, nejstarší první. Zdroj pro surface blok „nespárované
--        identity" (extranet/admin): reviewer vidí evidenci návrhu
--        (proposed_by, confidence) i source_key (bez něj nelze rozhodnout —
--        oprávněné čtení admin/staff, viz RLS na twin_external_refs).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (jen admin/staff — PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_identity_list_unmatched(
  p_entity_type text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_items jsonb;
BEGIN
  -- Ratifikace je lidská práce: jen admin/staff (service_role frontu nečte)
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at'), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'ref_id', r.id,
      'twin_id', r.twin_id,
      'twin_label', t.label,
      'entity_type', t.entity_type,
      'source', r.source,
      'source_key', r.source_key,
      'ref_kind', r.ref_kind,
      'proposed_by', r.proposed_by,
      'confidence', r.confidence,
      'note', r.note,
      'created_at', r.created_at,
      -- ⛔ PŘEVZETÍ KLÍČE MUSÍ BÝT VIDĚT (naměřeno 2026-09-20 při review):
      -- když tentýž klíč UŽ potvrzeně patří JINÉMU dvojčeti, je návrh ve
      -- skutečnosti žádost o PŘEDÁNÍ. Příznak `conflict` do té doby žil jen
      -- v návratové hodnotě propose_binding a v auditu, ve frontě nebyl —
      -- recenzent viděl obyčejný návrh a potvrzení mu pak spadlo na výjimku
      -- „key already confirmed for another twin", které nemusel rozumět.
      -- Pojistka v confirm_binding drží dál; tohle jen vrací člověku informaci.
      'conflict', EXISTS (
        SELECT 1 FROM public.twin_external_refs c
         WHERE c.source = r.source AND c.source_key = r.source_key
           AND c.ref_kind = r.ref_kind AND c.entity_type = r.entity_type
           AND c.state = 'confirmed'
           AND c.valid_to IS NULL AND c.twin_id <> r.twin_id)
    ) AS item
    FROM public.twin_external_refs r
    JOIN public.twin_entities t ON t.id = r.twin_id
    WHERE r.state = 'proposed'
      AND (p_entity_type IS NULL OR t.entity_type = p_entity_type)
    ORDER BY r.created_at
    LIMIT p_limit
  ) AS q;

  RETURN v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_identity_list_unmatched(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_identity_list_unmatched(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_identity_list_unmatched(text, integer) TO service_role;
