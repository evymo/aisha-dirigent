-- Function: public.process_token_reward
-- Arguments: p_user_id uuid, p_action_type text, p_reference_id uuid
-- Description: Awards the configured token_reward_rules payout for an action the CALLER performed.
--   Self-service by design (useProcessReward passes the session user's own id), so p_user_id is
--   pinned to auth.uid() rather than revoked.
-- Security: SECURITY DEFINER with search_path + auth.uid() ownership guard.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): granted to
--   `authenticated` and accepted ANY p_user_id with no authorization, so a logged-in user could
--   POST /rest/v1/rpc/process_token_reward with a victim's uuid and burn their once-per-action
--   reward eligibility (can_receive_reward cooldown) — the victim then permanently loses a payout
--   they never received. This is the mirror image of award_tokens: here the caller legitimately
--   awards THEMSELVES, so pinning p_user_id to auth.uid() is the correct fix and the grant stays.
-- KNOWN CRITICAL GAP — unlimited self-mint, NOT closed by the fix above (tracked, fix in flight):
--   p_action_type/p_reference_id are never verified against a real action. A user may claim a
--   reward for something they never did — and, contrary to a first reading, this is NOT bounded:
--   every limit in can_receive_reward is `IF v_rule.<limit> IS NOT NULL THEN ... END IF`, so a rule
--   with cooldown_hours/daily_limit/weekly_limit/monthly_limit all NULL skips EVERY check and
--   returns can_receive=true unconditionally. 8 of the 12 seeded rules are exactly that shape,
--   including study_completion at 100 tokens and placebo_compensation at 50 — repeatable in a loop.
--   The ONLY reason this is not exploitable today is an accident: all 12 seeded rules carry
--   token_type='PLATFORM' (aisha/db/seed/core/06_subscriptions.sql), and award_tokens raises on
--   any token_type outside ('governance','impact','data','aisha'). The reward feature is therefore
--   DEAD, and its deadness is the security control. DO NOT "fix" the token_type without landing the
--   evidence contract first — that single edit silently arms an unlimited mint.
--   The pin above is still necessary and orthogonal: it stops a user burning a VICTIM's eligibility.
--   Fixing the mint needs a per-action evidence contract (see the audit doc).
-- @audit: none (token operations logged in token_transactions table)

CREATE OR REPLACE FUNCTION public.process_token_reward(p_user_id uuid, p_action_type text, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule record;
  v_can_receive jsonb;
  v_amount integer;
  v_result jsonb;
BEGIN
  -- AUTHORIZATION FIRST — before any rule read or ledger write. A user may only process their
  -- OWN rewards; service_role (trusted backend) and admin/staff may act for anyone.
  -- is_service_role() is the NULL-safe reader — the inline request.jwt.claims idiom folds to
  -- NULL when the role claim is absent and would make this deny-guard fail OPEN.
  -- `auth.uid() IS NULL` is part of the deny condition on purpose: without it a NULL uid and a
  -- NULL p_user_id are NOT DISTINCT, so an unauthenticated caller would slip through the guard.
  IF NOT public.is_service_role()
     AND NOT public.is_admin_or_staff()
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
  THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Get all active rules for this action type
  FOR v_rule IN
    SELECT
      token_type,
      base_amount,
      multiplier,
      min_amount,
      max_amount,
      action_name_key,
      action_type
    FROM token_reward_rules
    WHERE action_type = p_action_type AND is_active = true
  LOOP
    -- Check if user can receive this reward
    v_can_receive := can_receive_reward(p_user_id, p_action_type, v_rule.token_type);
    
    IF (v_can_receive->>'can_receive')::boolean THEN
      -- Calculate amount
      v_amount := FLOOR(v_rule.base_amount * v_rule.multiplier);
      
      -- Apply min/max constraints
      IF v_rule.min_amount IS NOT NULL AND v_amount < v_rule.min_amount THEN
        v_amount := v_rule.min_amount;
      END IF;
      IF v_rule.max_amount IS NOT NULL AND v_amount > v_rule.max_amount THEN
        v_amount := v_rule.max_amount;
      END IF;
      
      -- Award the tokens
      v_result := award_tokens(
        p_user_id,
        v_rule.token_type,
        v_amount,
        p_action_type,
        p_reference_id,
        COALESCE(
          public.get_translation_value_with_fallback(v_rule.action_name_key, 'rewards', 'en', 'en', NULL),
          v_rule.action_type
        )
      );
    END IF;
  END LOOP;

  RETURN COALESCE(v_result, jsonb_build_object('success', false, 'reason', 'No rewards processed'));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.process_token_reward(p_user_id uuid, p_action_type text, p_reference_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_token_reward(p_user_id uuid, p_action_type text, p_reference_id uuid) TO authenticated;
