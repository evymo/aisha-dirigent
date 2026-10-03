-- ============================================================================
-- Source of Truth: twin_identity_match_candidates
-- Popis: Co ještě stojí za POROVNÁNÍ napříč světy — navržené reference jednoho
--        zdroje (typicky identifikační parametry z ingestu, např. e-mail
--        z Raynetu), jejichž dvojče ZATÍM nemá potvrzenou vazbu na cílový
--        zdroj (typicky účty aplikace).
--
-- ⛔ DOPORUČENÍ, NE VAZBA. Tahle funkce nic nespojuje ani nenavrhuje — jen
-- říká, na co se má porovnávací pruh zeptat zdroje. Návrh zakládá až
-- twin_identity_propose_match, potvrzení výhradně člověk v kokpitu
-- (submit_evidence_review_audited → twin_identity_confirm_binding). Týž vzor
-- jako advisory artefakty ingestu (li_entity_suggestions): DŮKAZ, ne fakt.
--
-- ⚠ PII: `value` je hodnota identifikačního parametru (e-mail). Proto
-- service_role nebo admin/staff, nikdy `authenticated` naslepo — a volající
-- ji nesmí nikam uložit; slouží jen k porovnání v paměti.
--
-- Vrací: [{ref_id, twin_id, twin_label, value}] , nejstarší návrhy první.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_identity_match_candidates(
  p_from_source text,
  p_ref_kind text,
  p_to_source text,
  p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_items jsonb;
BEGIN
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'twin_identity_match_candidates: service role or admin/staff required'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_from_source), '') = '' OR coalesce(btrim(p_ref_kind), '') = ''
     OR coalesce(btrim(p_to_source), '') = '' THEN
    RAISE EXCEPTION 'twin_identity_match_candidates: from_source, ref_kind and to_source are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'twin_identity_match_candidates: limit must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(i ORDER BY i->>'created_at'), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jsonb_build_object(
             'ref_id', r.id,
             'twin_id', r.twin_id,
             'twin_label', t.label,
             'value', r.source_key,
             'created_at', r.created_at) AS i
    FROM public.twin_external_refs r
    JOIN public.twin_entities t ON t.id = r.twin_id
    WHERE r.source = p_from_source
      AND r.ref_kind = p_ref_kind
      AND r.state = 'proposed'
      AND r.valid_to IS NULL
      -- dvojče, které už do cílového světa POTVRZENĚ patří, porovnávat nepotřebuje
      AND NOT EXISTS (
        SELECT 1 FROM public.twin_external_refs c
         WHERE c.twin_id = r.twin_id AND c.source = p_to_source
           AND c.state = 'confirmed' AND c.valid_to IS NULL)
    ORDER BY r.created_at
    LIMIT p_limit
  ) s;

  RETURN v_items;
END;
$function$;

REVOKE ALL ON FUNCTION public.twin_identity_match_candidates(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_identity_match_candidates(text, text, text, integer) TO authenticated, service_role;
