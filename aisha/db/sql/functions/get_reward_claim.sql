-- Function: public.get_reward_claim
-- Arguments: p_claim_id uuid, p_user_id uuid
-- Description: service_role read of a single reward claim by id, scoped to the
--   owning user — the authorization check for svc-blockchain POST /claim-reward.
-- Security: SECURITY DEFINER, service_role only

CREATE OR REPLACE FUNCTION public.get_reward_claim(p_claim_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'id', id,
    'user_id', user_id,
    'amount', amount,
    'denom', denom,
    'status', status
  )
  FROM reward_claims
  WHERE id = p_claim_id AND user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_reward_claim(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reward_claim(uuid, uuid) TO service_role;
