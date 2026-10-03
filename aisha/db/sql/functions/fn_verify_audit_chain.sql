-- Function: public.fn_verify_audit_chain
-- Arguments: p_limit integer DEFAULT NULL (max chain links to verify; NULL = whole chain)
-- Description: Broken-chain detector for the blockchain_audit_records hash chain.
--   Walks the linked list from genesis (previous_hash = 64 zeros) following
--   record_hash -> previous_hash links, recomputing every record_hash via
--   fn_audit_ledger_record_hash. Returns the FIRST broken link (fail-loud, precise):
--     { ok, rows_total, rows_verified, head_hash, first_broken }
--   first_broken reasons:
--     record_hash_mismatch                   — row content no longer matches its stored hash (tampered/corrupt)
--     fork_multiple_rows_share_previous_hash — two rows claim the same predecessor
--     cycle_detected                         — links loop (mass tampering)
--     missing_genesis                        — rows exist but nothing chains from genesis
--     unchained_rows                         — chain ended before covering every row (deleted/unhealed links)
-- Security: SECURITY DEFINER, search_path pinned, admin/staff or service_role only.

CREATE OR REPLACE FUNCTION public.fn_verify_audit_chain(
  p_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total    bigint;
  v_pos      bigint := 0;
  v_prev     text := repeat('0', 64);
  v_ids      uuid[];
  v_row      public.blockchain_audit_records%ROWTYPE;
  v_expected text;
BEGIN
  IF NOT (current_setting('role', true) = 'service_role' OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied: admin/staff or service_role required';
  END IF;

  SELECT count(*) INTO v_total FROM public.blockchain_audit_records;

  LOOP
    EXIT WHEN p_limit IS NOT NULL AND v_pos >= p_limit;

    SELECT array_agg(id) INTO v_ids
    FROM public.blockchain_audit_records
    WHERE previous_hash = v_prev;

    IF v_ids IS NULL THEN
      EXIT; -- end of chain
    END IF;

    IF array_length(v_ids, 1) > 1 THEN
      RETURN jsonb_build_object(
        'ok', false, 'rows_total', v_total, 'rows_verified', v_pos,
        'first_broken', jsonb_build_object(
          'position', v_pos + 1, 'ids', to_jsonb(v_ids),
          'reason', 'fork_multiple_rows_share_previous_hash'));
    END IF;

    IF v_pos >= v_total THEN
      RETURN jsonb_build_object(
        'ok', false, 'rows_total', v_total, 'rows_verified', v_pos,
        'first_broken', jsonb_build_object(
          'position', v_pos + 1, 'ids', to_jsonb(v_ids), 'reason', 'cycle_detected'));
    END IF;

    SELECT * INTO v_row FROM public.blockchain_audit_records WHERE id = v_ids[1];

    v_expected := public.fn_audit_ledger_record_hash(
      v_row.previous_hash, v_row.record_type, v_row.data, v_row.reference_table,
      v_row.reference_id, v_row.token_transaction_id, v_row.correlation_id, v_row.created_at);

    IF v_expected IS DISTINCT FROM v_row.record_hash THEN
      RETURN jsonb_build_object(
        'ok', false, 'rows_total', v_total, 'rows_verified', v_pos,
        'first_broken', jsonb_build_object(
          'position', v_pos + 1, 'id', v_row.id,
          'reason', 'record_hash_mismatch',
          'stored_hash', v_row.record_hash, 'expected_hash', v_expected));
    END IF;

    v_pos := v_pos + 1;
    v_prev := v_row.record_hash;
  END LOOP;

  IF p_limit IS NULL AND v_pos < v_total THEN
    RETURN jsonb_build_object(
      'ok', false, 'rows_total', v_total, 'rows_verified', v_pos,
      'first_broken', jsonb_build_object(
        'position', v_pos + 1,
        'reason', CASE WHEN v_pos = 0 THEN 'missing_genesis' ELSE 'unchained_rows' END,
        'rows_unreached', v_total - v_pos,
        'sample_unchained_ids', (
          SELECT COALESCE(jsonb_agg(s.id), '[]'::jsonb)
          FROM (
            SELECT id FROM public.blockchain_audit_records
            WHERE previous_hash IS NULL OR record_hash IS NULL
            LIMIT 5
          ) s)));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'rows_total', v_total, 'rows_verified', v_pos,
    'head_hash', CASE WHEN v_pos > 0 THEN v_prev ELSE NULL END,
    'first_broken', NULL);
END;
$function$;

COMMENT ON FUNCTION public.fn_verify_audit_chain(integer) IS
  'Walks the blockchain_audit_records hash chain from genesis, recomputing every link; '
  'returns the first broken link (fail-loud) or ok=true with the chain head hash.';

-- Permissions
REVOKE ALL ON FUNCTION public.fn_verify_audit_chain(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_verify_audit_chain(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_verify_audit_chain(integer) TO service_role;
