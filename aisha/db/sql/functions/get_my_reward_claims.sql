-- Function: get_my_reward_claims
-- User RPC: returns authenticated user's reward claims for on-chain fulfillment.
-- Allows users to track pending/fulfilled/failed claim status.

CREATE OR REPLACE FUNCTION public.get_my_reward_claims(
  p_limit integer DEFAULT 20
)
  RETURNS TABLE (
    id uuid,
    amount bigint,
    denom text,
    status text,
    tx_hash text,
    fulfilled_at timestamptz,
    created_at timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT rc.id, rc.amount, rc.denom, rc.status, rc.tx_hash,
         rc.fulfilled_at, rc.created_at
  FROM reward_claims rc
  WHERE rc.user_id = auth.uid()
  ORDER BY rc.created_at DESC
  LIMIT GREATEST(1, COALESCE(p_limit, 20));
END;
$function$;

REVOKE ALL ON FUNCTION get_my_reward_claims(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_reward_claims(integer) TO authenticated;
