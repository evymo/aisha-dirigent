-- Function: public.edge_blockchain_audit
-- Purpose: Edge-safe blockchain audit queue helpers.
--   služba (svc-blockchain record-audit, rpcService — správu ověří route): všechny akce

CREATE OR REPLACE FUNCTION public.edge_blockchain_audit(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- ⛔ JEN SLUŽBA (nález 2026-10-06, táž třída jako edge_bank_transactions).
  -- SECURITY DEFINER s GRANT pro authenticated a bez stráže: kdokoli přihlášený
  -- si přímým /rpc/edge_blockchain_audit vložil záznam do fronty kotvení auditu
  -- (insert_record s libovolným created_by a hashem = podvržený auditní řetězec)
  -- a počítal auditní aktivitu cizích účtů (count_requests s cizím user_id).
  -- Jediný volající je svc-blockchain service tokenem (route sama ověří správu);
  -- klientský grant proto níž odebrán a stráž drží i proti budoucímu grantu.
  IF public.is_service_role() IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'count_requests' THEN
    RETURN jsonb_build_object(
      'count',
      (
        SELECT count(*)
        FROM public.audit_journal a
        WHERE a.user_id = NULLIF(p_payload ->> 'user_id', '')::uuid
          AND a.action_type = 'integration'
          AND a.area = 'blockchain'
          AND a.entity_type = 'blockchain_audit'
          AND a.created_at >= COALESCE(NULLIF(p_payload ->> 'since', '')::timestamptz, now() - interval '1 hour')
      )
    );
  END IF;

  IF p_action = 'insert_record' THEN
    INSERT INTO public.blockchain_audit_records (
      data,
      record_hash,
      record_type
    )
    VALUES (
      jsonb_build_object(
        'created_by', NULLIF(p_payload ->> 'created_by', '')::uuid,
        'event_type', NULLIF(p_payload ->> 'event_type', ''),
        'payload', COALESCE(p_payload -> 'payload', '{}'::jsonb),
        'reference_id', NULLIF(p_payload ->> 'reference_id', ''),
        'reference_table', NULLIF(p_payload ->> 'reference_table', ''),
        'status', 'pending'
      ),
      NULLIF(p_payload ->> 'payload_hash', ''),
      NULLIF(p_payload ->> 'event_type', '')
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'ok', true);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_blockchain_audit(text, jsonb) FROM PUBLIC;
-- Explicitně i z authenticated: na běžící DB žije dřívější GRANT, který REVOKE
-- FROM PUBLIC nezruší (brána heals-revoke-reaches-existing-db).
REVOKE EXECUTE ON FUNCTION public.edge_blockchain_audit(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_blockchain_audit(text, jsonb) TO service_role;
