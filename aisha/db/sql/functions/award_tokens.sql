-- Function: public.award_tokens
-- Arguments: p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text, p_reference_id uuid, p_description text
-- Description: Mints tokens onto a membership's ledger. PRIVILEGED PRIMITIVE — the CALLER is
--   trusted to have authorized the award; this function does NOT authorize it. Reachable only
--   by service_role and by in-DB SECURITY DEFINER callers. NOT callable from the browser.
-- Security: the GRANT is the authorization boundary, deliberately — there is no JWT guard here.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): this function was
--   GRANTed to `authenticated` with ZERO authorization logic, so any logged-in user could
--   POST /rest/v1/rpc/award_tokens {p_user_id:<self>, p_token_type:'governance', p_amount:1e8}
--   and mint unlimited voting weight; a NEGATIVE p_amount against a victim's uuid drained their
--   balance and forged a 'reward' row in their ledger. The only "guard" was
--   useAdminGuard.guardAdminMutation — CLIENT-side React, which enforces nothing in the DB.
--   Self-award IS the exploit, so a `p_user_id <> auth.uid()` guard cannot fix it: the CALLER
--   must be restricted instead — hence REVOKE, not a predicate.
--
--   WHY NO is_service_role()/is_admin_or_staff() GUARD HERE: SECURITY DEFINER swaps current_user,
--   NOT the JWT claims, so such a guard would still read the ORIGINAL caller's claims and would
--   reject the legitimate in-DB awarders that mint for an ordinary user — log_health_state_audited,
--   confirm_product_taken_audited and submit_health_document_analysis_audited all award auth.uid()
--   after verifying ownership. Those callers run as the OWNER, who keeps EXECUTE by virtue of
--   ownership (REVOKE ... FROM PUBLIC does not touch it), and each authorizes its own recipient:
--     - award_leaderboard_rewards      → is_admin_or_staff(), recipient from period data
--     - log_health_state_audited       → recipient = auth.uid(), ownership-verified
--     - confirm_product_taken_audited  → recipient = auth.uid(), ownership-verified
--     - submit_health_document_analysis_audited → recipient = auth.uid(), access-verified
--     - process_token_reward           → p_user_id = auth.uid() unless service_role/admin
--   ANY NEW CALLER MUST DO THE SAME. Re-granting this function to `authenticated`/`anon` reopens
--   the hole; idor-prevention.gate.test.ts fails the build if that happens.
-- @audit: none (the ledger row in token_transactions is the record; the caller is trusted)

CREATE OR REPLACE FUNCTION public.award_tokens(p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_membership_id uuid;
  v_current_balance integer := 0;
  v_new_balance integer;
  v_transaction_id uuid;
BEGIN
  -- Positive amounts only. `v_new_balance := v_current_balance + p_amount` below means a
  -- negative amount is a BALANCE DRAIN that also forges a 'reward' ledger row — a distinct
  -- bug from the missing authorization, closed here. Use a debit RPC to spend tokens.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = format('award_tokens amount must be positive, got: %s', p_amount), ERRCODE = '22023';
  END IF;

  -- Validate token type
  IF p_token_type NOT IN ('governance', 'impact', 'data', 'aisha') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid token type: %s', p_token_type), ERRCODE = '22023';
  END IF;

  -- Get user's membership and current balance
  SELECT id,
    CASE p_token_type
      WHEN 'governance' THEN COALESCE(tokens_governance, 0)
      WHEN 'impact' THEN COALESCE(tokens_impact, 0)
      WHEN 'data' THEN COALESCE(tokens_data, 0)
      WHEN 'aisha' THEN COALESCE(tokens_aisha, 0)
    END
  INTO v_membership_id, v_current_balance
  FROM memberships
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Create membership if it doesn't exist
  IF v_membership_id IS NULL THEN
    INSERT INTO memberships (user_id, tier, status, payment_type)
    VALUES (p_user_id, 'basic', 'active', 'one_time')
    RETURNING id INTO v_membership_id;
    v_current_balance := 0;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + p_amount;

  -- Update membership balance
  IF p_token_type = 'governance' THEN
    UPDATE memberships SET tokens_governance = v_new_balance WHERE id = v_membership_id;
  ELSIF p_token_type = 'impact' THEN
    UPDATE memberships SET tokens_impact = v_new_balance WHERE id = v_membership_id;
  ELSIF p_token_type = 'data' THEN
    UPDATE memberships SET tokens_data = v_new_balance WHERE id = v_membership_id;
  ELSIF p_token_type = 'aisha' THEN
    UPDATE memberships SET tokens_aisha = v_new_balance WHERE id = v_membership_id;
  END IF;

  -- Record transaction
  INSERT INTO token_transactions (
    user_id,
    token_type,
    transaction_type,
    amount,
    balance_after,
    reference_type,
    reference_id,
    description
  ) VALUES (
    p_user_id,
    p_token_type,
    'reward',
    p_amount,
    v_new_balance,
    p_reference_type,
    p_reference_id,
    p_description
  ) RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_balance', v_current_balance,
    'new_balance', v_new_balance,
    'amount_awarded', p_amount
  );
END;
$function$
;

-- Permissions
-- service_role ONLY. The `authenticated` grant was the IDOR: PostgREST exposes every public
-- function, the gateway /rest/v1/* is a blanket proxy with no RPC allowlist, and
-- buildPostgrestClaims() hands every valid Keycloak token role=authenticated — so the grant
-- alone made this reachable by any logged-in user. Admin token-award goes through
-- award_tokens_admin_audited (which checks is_admin_or_staff IN THE DB, not in React).
REVOKE ALL ON FUNCTION public.award_tokens(p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text, p_reference_id uuid, p_description text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_tokens(p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text, p_reference_id uuid, p_description text) TO service_role;
