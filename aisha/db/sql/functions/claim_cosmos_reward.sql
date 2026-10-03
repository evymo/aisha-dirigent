-- Function: claim_cosmos_reward
-- User RPC: claims on-chain token reward by deducting balance and creating outbox record.
-- Flow: deduct memberships balance → token_transaction INSERT → fn_queue_blockchain_sync trigger → outbox
-- Only governance (ugov) and aisha (uash) tokens are eligible for on-chain claims (GDPR filter in trigger).
-- Requires cosmos_address set on profile (via update_my_cosmos_address).

CREATE OR REPLACE FUNCTION public.claim_cosmos_reward(
  p_amount bigint,
  p_denom text DEFAULT 'uash'
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_cosmos_address text;
  v_token_type text;
  v_membership_id uuid;
  v_current_balance integer;
  v_new_balance integer;
  v_claim_id uuid;
  v_transaction_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Map denom to token_type (only on-chain eligible types)
  v_token_type := CASE p_denom
    WHEN 'uash' THEN 'aisha'
    WHEN 'ugov' THEN 'governance'
    ELSE NULL
  END;

  IF v_token_type IS NULL THEN
    RAISE EXCEPTION 'Unsupported denom: %. Use uash or ugov.', p_denom
      USING ERRCODE = 'check_violation';
  END IF;

  -- Check cosmos_address exists on profile
  SELECT cosmos_address INTO v_cosmos_address
  FROM profiles
  WHERE id = v_user_id;

  IF v_cosmos_address IS NULL THEN
    RAISE EXCEPTION 'Cosmos address not set. Register your wallet first.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Get current balance from memberships
  SELECT id,
    CASE v_token_type
      WHEN 'governance' THEN COALESCE(tokens_governance, 0)
      WHEN 'aisha' THEN COALESCE(tokens_aisha, 0)
    END
  INTO v_membership_id, v_current_balance
  FROM memberships
  WHERE user_id = v_user_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'No membership found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Deduct balance
  v_new_balance := v_current_balance - p_amount;

  IF v_token_type = 'governance' THEN
    UPDATE memberships SET tokens_governance = v_new_balance WHERE id = v_membership_id;
  ELSIF v_token_type = 'aisha' THEN
    UPDATE memberships SET tokens_aisha = v_new_balance WHERE id = v_membership_id;
  END IF;

  -- Create token_transaction → triggers fn_queue_blockchain_sync → outbox
  INSERT INTO token_transactions (
    user_id,
    token_type,
    transaction_type,
    amount,
    balance_after,
    description
  ) VALUES (
    v_user_id,
    v_token_type,
    'claim',
    -p_amount,
    v_new_balance,
    format('On-chain claim: %s %s', p_amount, p_denom)
  ) RETURNING id INTO v_transaction_id;

  -- Create reward_claims record for tracking, LINKED to the originating
  -- token_transaction (D4: no double-fulfilment — the outbox fulfilment is bound
  -- 1:1 to a single ledger row).
  INSERT INTO reward_claims (user_id, amount, denom, status, transaction_id)
  VALUES (v_user_id, p_amount, p_denom, 'pending', v_transaction_id)
  RETURNING id INTO v_claim_id;

  -- Audit journal (no PII — only IDs)
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'blockchain'::journal_area,
    p_details := jsonb_build_object(
      'amount', p_amount,
      'denom', p_denom
    ),
    p_entity_id := v_claim_id::text,
    p_entity_type := 'reward_claims',
    p_severity := 'info'::journal_severity,
    p_summary := 'Cosmos reward claimed',
    p_user_id := v_user_id
  );

  RETURN v_claim_id;
END;
$function$;

REVOKE ALL ON FUNCTION claim_cosmos_reward(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_cosmos_reward(bigint, text) TO authenticated;
