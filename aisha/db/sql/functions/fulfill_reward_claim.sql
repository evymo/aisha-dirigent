-- Function: public.fulfill_reward_claim
-- Arguments: p_claim_id uuid, p_tx_hash text
-- Description: service_role marks a reward claim fulfilled after the on-chain
--   MsgSend broadcast succeeds (svc-blockchain POST /claim-reward). Idempotent-safe:
--   returns success:false when the claim id is unknown.
-- Security: SECURITY DEFINER, service_role only

CREATE OR REPLACE FUNCTION public.fulfill_reward_claim(p_claim_id uuid, p_tx_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_found uuid;
BEGIN
  UPDATE reward_claims
  SET status = 'fulfilled',
      tx_hash = p_tx_hash,
      fulfilled_at = now(),
      updated_at = now()
  WHERE id = p_claim_id
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'claim_not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'claim_id', v_found);
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_reward_claim(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_reward_claim(uuid, text) TO service_role;
