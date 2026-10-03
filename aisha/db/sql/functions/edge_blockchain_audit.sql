-- Function: public.edge_blockchain_audit
-- Purpose: Edge-safe blockchain audit queue helpers.

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
GRANT EXECUTE ON FUNCTION public.edge_blockchain_audit(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_blockchain_audit(text, jsonb) TO authenticated;
