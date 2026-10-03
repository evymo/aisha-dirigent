-- Function: public.update_blockchain_audit_status
-- Arguments: p_id uuid, p_status text, p_error_message text, p_retry_count int, p_cosmos_tx_hash text
-- Description: Updates the status of a blockchain audit record during ledger sync.
-- Security: SECURITY DEFINER, service_role only

CREATE OR REPLACE FUNCTION public.update_blockchain_audit_status(
  p_id uuid,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_retry_count int DEFAULT NULL,
  p_cosmos_tx_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.blockchain_audit_records
  SET status = p_status,
      cosmos_tx_hash = COALESCE(p_cosmos_tx_hash, cosmos_tx_hash),
      retry_count = COALESCE(p_retry_count, retry_count),
      error_message = COALESCE(p_error_message, error_message),
      processing_started_at = CASE WHEN p_status = 'processing' THEN now() ELSE processing_started_at END,
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_blockchain_audit_status(uuid, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_blockchain_audit_status(uuid, text, text, int, text) TO service_role;
