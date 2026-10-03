-- Function: public.create_reward_rule_admin
-- Arguments: p_action_name_key text, p_action_type text, p_base_amount numeric, p_token_type text, ...
-- Description: Creates a new token reward rule. Admin only with audit logging.
-- Security: SECURITY DEFINER with admin guard and audit.
-- @admin: true
-- @audit: create (area: tokens)

CREATE OR REPLACE FUNCTION public.create_reward_rule_admin(
  p_action_name_key text,
  p_action_type text,
  p_base_amount numeric,
  p_token_type text,
  p_cooldown_hours integer DEFAULT NULL::integer,
  p_daily_limit integer DEFAULT NULL::integer,
  p_description_key text DEFAULT NULL::text,
  p_is_active boolean DEFAULT true,
  p_max_amount numeric DEFAULT NULL::numeric,
  p_membership_tier_required text DEFAULT NULL::text,
  p_min_amount numeric DEFAULT NULL::numeric,
  p_monthly_limit integer DEFAULT NULL::integer,
  p_multiplier numeric DEFAULT 1,
  p_requires_membership boolean DEFAULT false,
  p_sort_order integer DEFAULT 0,
  p_weekly_limit integer DEFAULT NULL::integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
SET search_path TO 'public'
 SET search_path = public
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  INSERT INTO token_reward_rules (
    action_name_key, action_type, base_amount, cooldown_hours, daily_limit,
    description_key, is_active, max_amount, membership_tier_required,
    min_amount, monthly_limit, multiplier, requires_membership,
    sort_order, token_type, weekly_limit
  )
  VALUES (
    p_action_name_key, p_action_type, p_base_amount, p_cooldown_hours, p_daily_limit,
    p_description_key, p_is_active, p_max_amount, p_membership_tier_required,
    p_min_amount, p_monthly_limit, p_multiplier, p_requires_membership,
    p_sort_order, p_token_type, p_weekly_limit
  )
  RETURNING row_to_json(token_reward_rules)::jsonb INTO v_result;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := (v_result->>'id'),
      p_entity_type := 'reward_rule',
      p_new_values := v_result,
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Created reward rule: ' || p_action_type,
      p_tags := ARRAY['admin', 'tokens', 'reward', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_reward_rule_admin(text, text, numeric, text, integer, integer, text, boolean, numeric, text, numeric, integer, numeric, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reward_rule_admin(text, text, numeric, text, integer, integer, text, boolean, numeric, text, numeric, integer, numeric, boolean, integer, integer) TO authenticated;
