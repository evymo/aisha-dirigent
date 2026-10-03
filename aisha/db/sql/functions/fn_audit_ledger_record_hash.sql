-- Function: public.fn_audit_ledger_record_hash
-- Arguments: p_previous_hash text, p_record_type text, p_data jsonb, p_reference_table text,
--            p_reference_id uuid, p_token_transaction_id uuid, p_correlation_id uuid, p_created_at timestamptz
-- Description: Canonical, deterministic SHA-256 record hash for the blockchain_audit_records
--   hash chain. NO now()/random salt — every input is a stored column of the row, so any
--   auditor can recompute the hash from the row alone. The previous_hash input links the
--   row to its predecessor (tamper-evident chain). created_at is folded in as an epoch
--   microsecond integer (timezone/locale independent); jsonb::text is PostgreSQL-canonical
--   (sorted keys, normalized whitespace) and therefore deterministic.
-- Security: IMMUTABLE SQL, schema-qualified pgcrypto call, search_path pinned.

CREATE OR REPLACE FUNCTION public.fn_audit_ledger_record_hash(
  p_previous_hash text,
  p_record_type text,
  p_data jsonb,
  p_reference_table text,
  p_reference_id uuid,
  p_token_transaction_id uuid,
  p_correlation_id uuid,
  p_created_at timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'schema', 'aisha.audit_ledger.v1',
    'previous_hash', p_previous_hash,
    'record_type', p_record_type,
    'data', COALESCE(p_data, '{}'::jsonb),
    'reference_table', p_reference_table,
    'reference_id', p_reference_id,
    'token_transaction_id', p_token_transaction_id,
    'correlation_id', p_correlation_id,
    'created_at_epoch_us', CASE
      WHEN p_created_at IS NULL THEN NULL
      ELSE (extract(epoch FROM p_created_at) * 1000000)::bigint
    END
  )::text, 'UTF8'), 'sha256'), 'hex');
$function$;

COMMENT ON FUNCTION public.fn_audit_ledger_record_hash(text, text, jsonb, text, uuid, uuid, uuid, timestamptz) IS
  'Deterministic canonical SHA-256 for the audit-ledger hash chain (aisha.audit_ledger.v1). '
  'Recomputable from stored row columns only — no clock/random salt.';

-- Permissions
REVOKE ALL ON FUNCTION public.fn_audit_ledger_record_hash(text, text, jsonb, text, uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_audit_ledger_record_hash(text, text, jsonb, text, uuid, uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_ledger_record_hash(text, text, jsonb, text, uuid, uuid, uuid, timestamptz) TO service_role;
