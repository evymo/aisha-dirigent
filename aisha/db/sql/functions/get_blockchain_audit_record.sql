-- Function: public.get_blockchain_audit_record
-- Arguments: p_id uuid
-- Description: Retrieves a blockchain audit record by ID for ledger sync processing.
-- Security: SECURITY DEFINER, service_role only

CREATE OR REPLACE FUNCTION public.get_blockchain_audit_record(p_id uuid)
RETURNS SETOF blockchain_audit_records
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    id, record_type, record_hash, data, previous_hash, created_at,
    status, retry_count, max_attempts, next_retry_at, processing_started_at,
    updated_at, cosmos_tx_hash, error_message, correlation_id,
    token_transaction_id, reference_table, reference_id
  FROM blockchain_audit_records
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.get_blockchain_audit_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_blockchain_audit_record(uuid) TO service_role;
