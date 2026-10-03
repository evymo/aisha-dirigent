-- ============================================================================
-- Source of Truth: twin_identity_propose_match
-- Popis: Založí DOPORUČENÍ vazby identity napříč světy (porovnávací pruh
--        ingestu: „tenhle kontakt z CRM vypadá jako tenhle účet"). Obal nad
--        twin_identity_propose_binding, který navíc ctí LIDSKÉ „NE".
--
-- ⛔ ZAMÍTNUTÝ NÁVRH SE NEVRACÍ. twin_identity_propose_binding je idempotentní
-- vůči potvrzeným a navrženým vazbám, ale NE vůči zamítnutým — pruh, který by
-- ho volal každý takt, by rozhodnutí člověka přehlasoval tím, že mu tentýž pár
-- nabídne znovu. Fronta by nikdy nezkonvergovala (týž nález jako u ratifikační
-- fronty mapy toku). Proto se tu zamítnutý pár přeskakuje a řekne se to nahlas
-- ve výsledku, ne mlčky.
--
-- Nic nepotvrzuje: potvrzení je výhradně lidské, z kokpitu přes
-- submit_evidence_review_audited (kind 'twin_identity').
--
-- Vrací: {state: proposed|confirmed|skipped_rejected, ref_id, already, conflict}
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_identity_propose_match(
  p_twin_id uuid,
  p_to_source text,
  p_source_key text,
  p_ref_kind text DEFAULT 'primary_id',
  p_proposed_by text DEFAULT 'rule:match',
  p_confidence numeric DEFAULT NULL,
  p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rejected uuid;
BEGIN
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'twin_identity_propose_match: service role or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  SELECT r.id INTO v_rejected
  FROM public.twin_external_refs r
  WHERE r.twin_id = p_twin_id
    AND r.source = p_to_source
    AND r.source_key = p_source_key
    AND r.ref_kind = p_ref_kind
    AND r.state = 'rejected'
  ORDER BY r.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_rejected IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'skipped_rejected', 'ref_id', v_rejected, 'already', true);
  END IF;

  RETURN public.twin_identity_propose_binding(
    p_twin_id, p_to_source, p_source_key, p_ref_kind, p_proposed_by, p_confidence, p_note);
END;
$function$;

REVOKE ALL ON FUNCTION public.twin_identity_propose_match(uuid, text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_identity_propose_match(uuid, text, text, text, text, numeric, text) TO authenticated, service_role;
