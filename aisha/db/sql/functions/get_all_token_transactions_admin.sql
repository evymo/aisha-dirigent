-- Function: public.get_all_token_transactions_admin
-- Arguments: p_limit integer, p_token_type text, p_transaction_type text, p_user_id text, p_reference_type text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:34+01:00

CREATE OR REPLACE FUNCTION public.get_all_token_transactions_admin(p_limit integer DEFAULT 100, p_token_type text DEFAULT NULL::text, p_transaction_type text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text, p_reference_type text DEFAULT NULL::text)
 RETURNS TABLE(amount numeric, balance_after numeric, created_at timestamptz, description text, id uuid, reference_id uuid, reference_type text, token_type text, transaction_type text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'tokens'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_transaction',
      p_new_values := jsonb_build_object('limit', p_limit),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read token transaction',
      p_tags := ARRAY['admin', 'token_transaction'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    tt.amount::numeric,
    tt.balance_after::numeric,
    tt.created_at::text,
    tt.description,
    tt.id,
    tt.reference_id,
    tt.reference_type,
    tt.token_type,
    tt.transaction_type,
    tt.user_id
  FROM token_transactions tt
  WHERE 
    (p_token_type IS NULL OR tt.token_type = p_token_type)
    AND (p_transaction_type IS NULL OR tt.transaction_type = p_transaction_type)
    AND (p_user_id IS NULL OR tt.user_id::text = p_user_id)
    AND (p_reference_type IS NULL OR tt.reference_type = p_reference_type)
  ORDER BY tt.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_all_token_transactions_admin(p_limit integer, p_token_type text, p_transaction_type text, p_user_id text, p_reference_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_token_transactions_admin(p_limit integer, p_token_type text, p_transaction_type text, p_user_id text, p_reference_type text) TO authenticated;
