-- Function: public.create_token_transaction
-- Arguments: p_token_type text, p_amount numeric, p_transaction_type text, p_description text, p_user_id uuid, p_reference_id text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:20+01:00

CREATE OR REPLACE FUNCTION public.create_token_transaction(p_token_type text, p_amount numeric, p_transaction_type text, p_description text, p_user_id uuid DEFAULT NULL::uuid, p_reference_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := COALESCE(p_user_id, auth.uid());
  v_tx_id UUID;
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM token_transactions
  WHERE user_id = v_user_id AND token_type = p_token_type::token_type;

  INSERT INTO token_transactions (user_id, token_type, amount, transaction_type, description, reference_id, balance_after)
  VALUES (v_user_id, p_token_type::token_type, p_amount, p_transaction_type::token_transaction_type, p_description, p_reference_id, v_balance + p_amount)
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_token_transaction(p_token_type text, p_amount numeric, p_transaction_type text, p_description text, p_user_id uuid, p_reference_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_token_transaction(p_token_type text, p_amount numeric, p_transaction_type text, p_description text, p_user_id uuid, p_reference_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_token_transaction(p_token_type text, p_amount numeric, p_transaction_type text, p_description text, p_user_id uuid, p_reference_id text) TO service_role;
