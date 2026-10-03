-- Function: public.record_chain_head_anchor
-- Arguments: p_cosmos_tx_hash text, p_error_message text, p_head_hash text, p_rows_verified bigint, p_status text
-- Description: Persist the result of a Path-2 chain-head on-chain attestation.
--   Called by svc-blockchain's /chain-head-anchor route AFTER it reads the DB
--   chain head (fn_verify_audit_chain head_hash) and broadcasts it to the Cosmos
--   ledger as an attestation memo. Inserts one immutable row into
--   chain_head_anchors (the external tamper-evidence ledger) and writes an audit
--   journal entry. Returns the new anchor row id.
-- Security: SECURITY DEFINER, search_path pinned, service_role only (writes are
--   driven exclusively by the service route, never by end users).

CREATE OR REPLACE FUNCTION public.record_chain_head_anchor(
  p_cosmos_tx_hash text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_head_hash text DEFAULT NULL,
  p_rows_verified bigint DEFAULT NULL,
  p_status text DEFAULT 'confirmed'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor_id uuid;
BEGIN
  -- Least-privilege: only the service_role (the svc-blockchain route) may record
  -- an attestation. Fail loud otherwise — no silent no-op.
  IF NOT (current_setting('role', true) = 'service_role' OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied: service_role required to record a chain-head anchor';
  END IF;

  IF p_head_hash IS NULL OR length(p_head_hash) = 0 THEN
    RAISE EXCEPTION 'record_chain_head_anchor: p_head_hash is required';
  END IF;

  IF p_status NOT IN ('confirmed', 'failed') THEN
    RAISE EXCEPTION 'record_chain_head_anchor: invalid status %', p_status;
  END IF;

  INSERT INTO public.chain_head_anchors (
    head_hash, rows_verified, cosmos_tx_hash, status, error_message
  ) VALUES (
    p_head_hash, p_rows_verified, p_cosmos_tx_hash, p_status, p_error_message
  )
  RETURNING id INTO v_anchor_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'integration'::public.journal_action_type,
    p_area := 'blockchain'::public.journal_area,
    p_details := jsonb_build_object(
      'head_hash', p_head_hash,
      'rows_verified', p_rows_verified,
      'cosmos_tx_hash', p_cosmos_tx_hash,
      'status', p_status),
    p_entity_id := v_anchor_id::text,
    p_entity_type := 'chain_head_anchor',
    p_new_values := jsonb_build_object(
      'head_hash', p_head_hash,
      'cosmos_tx_hash', p_cosmos_tx_hash,
      'status', p_status),
    p_severity := CASE WHEN p_status = 'failed' THEN 'warning'::public.journal_severity
                       ELSE 'info'::public.journal_severity END,
    p_summary := 'Chain-head anchored on Cosmos ledger',
    p_tags := ARRAY['blockchain', 'chain_head_anchor', 'attestation']
  );

  RETURN v_anchor_id;
END;
$function$;

COMMENT ON FUNCTION public.record_chain_head_anchor(text, text, text, bigint, text) IS
  'Persists a Path-2 chain-head on-chain attestation (head_hash + Cosmos tx hash) '
  'into chain_head_anchors and writes an audit journal entry; service_role only.';

-- Permissions
REVOKE ALL ON FUNCTION public.record_chain_head_anchor(text, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_chain_head_anchor(text, text, text, bigint, text) TO service_role;
