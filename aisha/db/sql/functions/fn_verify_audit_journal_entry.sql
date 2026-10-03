-- Function: public.fn_verify_audit_journal_entry
-- Arguments: p_entry_id uuid
-- Description: Chain-of-custody verification for a single audit_journal entry hash.
--   write_audit_journal (v2) computes blockchain_hash deterministically over the row's
--   STORED columns (action, entity_type, entity_id, created_at, new_data, metadata minus
--   the hash itself) with a 'v2:' prefix — this function recomputes it and reports:
--     verified            — recomputed hash matches the stored hash
--     broken              — stored v2 hash does NOT match the row content (tampered/corrupt)
--     unverifiable_legacy — pre-v2 hash (salted with insert-time now()::text, session-timezone
--                           dependent, and computed over inputs that were not stored 1:1);
--                           decorative by construction, honestly reported as unverifiable
--     no_hash             — row carries no hash at all
--   user_id is deliberately NOT part of the hash: audit_journal.user_id has FK
--   ON DELETE SET NULL (user erasure mutates the row by design).
-- Security: SECURITY DEFINER, search_path pinned, admin/staff or service_role only.

CREATE OR REPLACE FUNCTION public.fn_verify_audit_journal_entry(
  p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row      public.audit_journal%ROWTYPE;
  v_stored   text;
  v_expected text;
BEGIN
  IF NOT (current_setting('role', true) = 'service_role' OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied: admin/staff or service_role required';
  END IF;

  SELECT * INTO v_row FROM public.audit_journal WHERE id = p_entry_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'audit_journal entry % not found', p_entry_id;
  END IF;

  v_stored := COALESCE(v_row.blockchain_hash, v_row.metadata ->> 'blockchain_hash');

  IF v_stored IS NULL THEN
    RETURN jsonb_build_object('entry_id', p_entry_id, 'state', 'no_hash', 'stored_hash', NULL);
  END IF;

  IF v_stored NOT LIKE 'v2:%' THEN
    RETURN jsonb_build_object('entry_id', p_entry_id, 'state', 'unverifiable_legacy', 'stored_hash', v_stored);
  END IF;

  v_expected := 'v2:' || encode(extensions.digest(convert_to(jsonb_build_object(
    'schema', 'aisha.audit_journal.hash.v2',
    'action', v_row.action,
    'entity_type', v_row.entity_type,
    'entity_id', v_row.entity_id,
    'created_at_epoch_us', (extract(epoch FROM v_row.created_at) * 1000000)::bigint,
    'new_data', v_row.new_data,
    'metadata', COALESCE(v_row.metadata, '{}'::jsonb) - 'blockchain_hash'
  )::text, 'UTF8'), 'sha256'), 'hex');

  RETURN jsonb_build_object(
    'entry_id', p_entry_id,
    'state', CASE WHEN v_expected = v_stored THEN 'verified' ELSE 'broken' END,
    'stored_hash', v_stored,
    'expected_hash', v_expected);
END;
$function$;

COMMENT ON FUNCTION public.fn_verify_audit_journal_entry(uuid) IS
  'Recomputes the deterministic v2 audit_journal blockchain_hash from stored columns; '
  'returns verified/broken/unverifiable_legacy/no_hash (fail-loud on missing entry).';

-- Permissions
REVOKE ALL ON FUNCTION public.fn_verify_audit_journal_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_verify_audit_journal_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_verify_audit_journal_entry(uuid) TO service_role;
