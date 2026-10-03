-- Function: upsert_contract_extract_audited
-- Evidence layer (E5): upserts the structured extract for a registered contract
-- document and ATOMICALLY replaces its obligations. Service-role only (NULL-safe
-- guard). Invariants:
--   * re-extract DROPS human_verified (a human must re-confirm after content change),
--   * obligations are replaced as a set and are ALWAYS born human_confirmed=false
--     (legal content is never authoritative without a human).

CREATE OR REPLACE FUNCTION public.upsert_contract_extract_audited(
  p_document_id uuid,
  p_extract jsonb,
  p_confidence numeric DEFAULT NULL::numeric,
  p_counterparty text DEFAULT NULL::text,
  p_subject text DEFAULT NULL::text,
  p_valid_from date DEFAULT NULL::date,
  p_valid_to date DEFAULT NULL::date,
  p_obligations jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contract_id uuid;
  v_obligation_count integer := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.document_registry WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown document' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.contract_register AS cr (
    document_id, counterparty, subject, valid_from, valid_to, extract, confidence
  )
  VALUES (
    p_document_id, p_counterparty, p_subject, p_valid_from, p_valid_to,
    COALESCE(p_extract, '{}'::jsonb), p_confidence
  )
  ON CONFLICT (document_id) DO UPDATE SET
    counterparty   = EXCLUDED.counterparty,
    subject        = EXCLUDED.subject,
    valid_from     = EXCLUDED.valid_from,
    valid_to       = EXCLUDED.valid_to,
    extract        = EXCLUDED.extract,
    confidence     = EXCLUDED.confidence,
    -- re-extract invalidates prior human verification
    human_verified = false,
    verified_by    = NULL,
    verified_at    = NULL,
    updated_at     = now()
  RETURNING cr.id INTO v_contract_id;

  -- atomic obligation replacement (same tx): delete-then-insert from the payload
  DELETE FROM public.obligation_register WHERE contract_id = v_contract_id;
  INSERT INTO public.obligation_register (
    contract_id, obliged_party, action, due_rule, consequence, source_clause
  )
  SELECT
    v_contract_id,
    o->>'obliged_party',
    o->>'action',
    COALESCE(o->'due_rule', '{}'::jsonb),
    o->>'consequence',
    o->'source_clause'
  FROM jsonb_array_elements(COALESCE(p_obligations, '[]'::jsonb)) AS o;
  GET DIAGNOSTICS v_obligation_count = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'CONTRACT_EXTRACT_UPSERTED', 'CONTRACT_EXTRACT_UPSERTED', 'content', 'info',
          ARRAY['evidence', 'contract'],
          jsonb_build_object('document_id', p_document_id, 'confidence', p_confidence,
                             'obligations', v_obligation_count));

  RETURN jsonb_build_object('contract_id', v_contract_id, 'obligations', v_obligation_count);
END;
$function$

;

REVOKE ALL ON FUNCTION upsert_contract_extract_audited(uuid,jsonb,numeric,text,text,date,date,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_contract_extract_audited(uuid,jsonb,numeric,text,text,date,date,jsonb) TO service_role;
