-- Function: public.get_my_wallet_balance
-- Returns the authenticated user's token wallet balance across ALL four token
-- types, including the platform (aisha) token the reward-shop UI reads as the
-- "platform balance".
-- D4 (single source): the balance DERIVES from the append-only token_transactions
-- ledger (SUM of amounts per token_type) — the one canonical source — instead of
-- blind-reading the user_wallets projection. user_wallets stays a fast cache kept in
-- sync by update_user_wallet_balance, but the reader folds the ledger so the number
-- the app shows can never silently disagree with the recorded flow.
-- NOTE: this RETURNS TABLE shape is a contract with walletBalanceSchema in
-- src/hooks/useRewardShop.ts (asserted by the wallet-reader-schema-contract gate).
-- Adding/removing a column changes the function's return type, which
-- CREATE OR REPLACE cannot do in place — it needs DROP FUNCTION first.

CREATE OR REPLACE FUNCTION public.get_my_wallet_balance()
RETURNS TABLE (
  user_id uuid,
  governance_tokens numeric,
  impact_tokens numeric,
  data_tokens numeric,
  aisha_tokens numeric,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Canonical balance = fold of the token_transactions ledger (single source).
  RETURN QUERY
  SELECT
    v_user_id AS user_id,
    COALESCE(SUM(t.amount) FILTER (WHERE t.token_type = 'governance'), 0)::numeric AS governance_tokens,
    COALESCE(SUM(t.amount) FILTER (WHERE t.token_type = 'impact'), 0)::numeric AS impact_tokens,
    COALESCE(SUM(t.amount) FILTER (WHERE t.token_type = 'data'), 0)::numeric AS data_tokens,
    COALESCE(SUM(t.amount) FILTER (WHERE t.token_type = 'aisha'), 0)::numeric AS aisha_tokens,
    COALESCE(MAX(t.created_at), now()) AS updated_at
  FROM public.token_transactions t
  WHERE t.user_id = v_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_wallet_balance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_balance() TO authenticated;
