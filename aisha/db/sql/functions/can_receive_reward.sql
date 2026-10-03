-- Function: public.can_receive_reward
-- Arguments: p_user_id uuid, p_action_type text, p_token_type text
-- Description: Checks if user can receive a reward.
-- Security: SECURITY DEFINER with search_path + stráž volajícího (p_user_id = auth.uid(),
--   jinak jen service_role nebo admin/staff) — stejný tvar jako process_token_reward.
-- @audit: none (read-only check)

CREATE OR REPLACE FUNCTION public.can_receive_reward(p_user_id uuid, p_action_type text, p_token_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule record;
  v_daily_count integer;
  v_weekly_count integer;
  v_monthly_count integer;
  v_last_reward timestamptz;
  v_hours_since_last numeric;
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Odpověď nese
  -- členství (`Membership requirement not met`), počty odměn za den/týden/měsíc
  -- (`current_count`) i zbývající hodiny cooldownu — pro libovolné uuid, které
  -- přihlášený pošle. Sourozenec process_token_reward má stráž od 2026-07-15
  -- (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md); tahle funkce, kterou
  -- volá, ji neměla, takže týž údaj šel přečíst přímo.
  --
  -- Stráž je PŘESNĚ tvar sourozence: ptá se o sobě, nebo služba/správa. Změřeno,
  -- že to nic nerozbije: useCanReceiveReward (src/hooks/useTokens.ts) posílá
  -- `p_user_id: user.id`, tedy sebe, a process_token_reward předává p_user_id,
  -- který už prošel touž stráží. `auth.uid() IS NULL` je součást odmítnutí
  -- záměrně: bez něj by NULL uid a NULL p_user_id nebyly DISTINCT a anonym by
  -- prošel.
  IF NOT public.is_service_role()
     AND NOT public.is_admin_or_staff()
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
  THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Get the reward rule
  SELECT * INTO v_rule
  FROM token_reward_rules
  WHERE action_type = p_action_type
    AND token_type = p_token_type
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_receive', false,
      'reason', 'No active reward rule found for this action'
    );
  END IF;

  -- Check membership requirement
  IF v_rule.requires_membership THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships
      WHERE user_id = p_user_id
        AND status = 'active'
        AND (v_rule.membership_tier_required IS NULL OR tier::text = v_rule.membership_tier_required)
    ) THEN
      RETURN jsonb_build_object(
        'can_receive', false,
        'reason', 'Membership requirement not met'
      );
    END IF;
  END IF;

  -- Check daily limit
  IF v_rule.daily_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_daily_count
    FROM token_transactions
    WHERE user_id = p_user_id
      AND token_type = p_token_type
      AND reference_type = p_action_type
      AND created_at >= CURRENT_DATE;
    
    IF v_daily_count >= v_rule.daily_limit THEN
      RETURN jsonb_build_object(
        'can_receive', false,
        'reason', 'Daily limit reached',
        'limit', v_rule.daily_limit,
        'current_count', v_daily_count
      );
    END IF;
  END IF;

  -- Check weekly limit
  IF v_rule.weekly_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_weekly_count
    FROM token_transactions
    WHERE user_id = p_user_id
      AND token_type = p_token_type
      AND reference_type = p_action_type
      AND created_at >= date_trunc('week', CURRENT_TIMESTAMP);
    
    IF v_weekly_count >= v_rule.weekly_limit THEN
      RETURN jsonb_build_object(
        'can_receive', false,
        'reason', 'Weekly limit reached',
        'limit', v_rule.weekly_limit,
        'current_count', v_weekly_count
      );
    END IF;
  END IF;

  -- Check monthly limit
  IF v_rule.monthly_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_monthly_count
    FROM token_transactions
    WHERE user_id = p_user_id
      AND token_type = p_token_type
      AND reference_type = p_action_type
      AND created_at >= date_trunc('month', CURRENT_TIMESTAMP);
    
    IF v_monthly_count >= v_rule.monthly_limit THEN
      RETURN jsonb_build_object(
        'can_receive', false,
        'reason', 'Monthly limit reached',
        'limit', v_rule.monthly_limit,
        'current_count', v_monthly_count
      );
    END IF;
  END IF;

  -- Check cooldown
  IF v_rule.cooldown_hours IS NOT NULL THEN
    SELECT created_at INTO v_last_reward
    FROM token_transactions
    WHERE user_id = p_user_id
      AND token_type = p_token_type
      AND reference_type = p_action_type
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_reward IS NOT NULL THEN
      v_hours_since_last := EXTRACT(EPOCH FROM (now() - v_last_reward)) / 3600;
      IF v_hours_since_last < v_rule.cooldown_hours THEN
        RETURN jsonb_build_object(
          'can_receive', false,
          'reason', 'Cooldown period active',
          'hours_remaining', v_rule.cooldown_hours - v_hours_since_last
        );
      END IF;
    END IF;
  END IF;

  -- All checks passed
  RETURN jsonb_build_object(
    'can_receive', true,
    'rule_id', v_rule.id,
    'base_amount', v_rule.base_amount,
    'multiplier', v_rule.multiplier
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.can_receive_reward(p_user_id uuid, p_action_type text, p_token_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_receive_reward(p_user_id uuid, p_action_type text, p_token_type text) TO authenticated;
