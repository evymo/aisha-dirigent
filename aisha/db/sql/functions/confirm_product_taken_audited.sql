-- Function: public.confirm_product_taken_audited
-- Arguments: p_plan_id uuid, p_taken_at timestamp with time zone DEFAULT now(), p_dose_taken numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.confirm_product_taken_audited(p_plan_id uuid, p_taken_at timestamp with time zone DEFAULT now(), p_dose_taken numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log_id uuid;
  v_plan record;
  v_actual_dose numeric;
  v_reward_rule record;
  v_tokens_earned int := 0;
  v_token_type text := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get and verify plan
  SELECT * INTO v_plan FROM member_product_plans WHERE id = p_plan_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or not owned';
  END IF;

  -- Use provided dose or plan default
  v_actual_dose := COALESCE(p_dose_taken, v_plan.dose_amount);

  -- Log the dose
  INSERT INTO member_product_logs (user_id, plan_id, product_id, catalog_product_id, dose_taken, logged_at, notes)
  VALUES (auth.uid(), p_plan_id, v_plan.product_id, v_plan.product_id, v_actual_dose, p_taken_at, p_notes)
  RETURNING id INTO v_log_id;

  -- Update plan
  UPDATE member_product_plans 
  SET 
    last_taken_at = p_taken_at,
    remaining_doses = GREATEST(0, remaining_doses - v_actual_dose),
    next_reminder_at = NULL
  WHERE id = p_plan_id;

  -- Award tokens based on reward rules
  SELECT * INTO v_reward_rule FROM token_reward_rules 
  WHERE action_type = 'dosing_log' AND is_active = true LIMIT 1;
  
  IF v_reward_rule IS NOT NULL THEN
    v_token_type := v_reward_rule.token_type;
    v_tokens_earned := COALESCE(v_reward_rule.base_amount * v_reward_rule.multiplier, 0)::int;
    
    IF v_tokens_earned > 0 THEN
      PERFORM award_tokens(
        auth.uid(),
        v_reward_rule.token_type,
        v_tokens_earned,
        'product_log',
        v_log_id,
        format('Dosing log: %s', v_plan.dose_unit)
      );
    END IF;
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'create', 'member_product_log', v_log_id::text, 'member', 'info', 
          format('Confirmed product taken: %s %s (+%s tokens)', v_actual_dose, v_plan.dose_unit, v_tokens_earned));

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'tokens_earned', v_tokens_earned,
    'token_type', v_token_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_product_taken_audited(uuid, timestamptz, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_product_taken_audited(uuid, timestamptz, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_product_taken_audited(uuid, timestamptz, numeric, text) TO service_role;
