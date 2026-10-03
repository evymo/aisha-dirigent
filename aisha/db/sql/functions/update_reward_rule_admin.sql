-- Function: public.update_reward_rule_admin
-- Arguments: p_rule_id uuid, p_action_name_key text, p_action_type text, ...
-- Description: Updates token reward rule. Admin only with audit logging.
-- Security: SECURITY DEFINER with admin guard and audit.
-- @admin: true
-- @audit: update (area: tokens)

CREATE OR REPLACE FUNCTION public.update_reward_rule_admin(
  p_rule_id uuid,
  p_action_name_key text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text,
  p_base_amount numeric DEFAULT NULL::numeric,
  p_cooldown_hours integer DEFAULT NULL::integer,
  p_daily_limit integer DEFAULT NULL::integer,
  p_description_key text DEFAULT NULL::text,
  p_is_active boolean DEFAULT NULL::boolean,
  p_max_amount numeric DEFAULT NULL::numeric,
  p_membership_tier_required text DEFAULT NULL::text,
  p_min_amount numeric DEFAULT NULL::numeric,
  p_monthly_limit integer DEFAULT NULL::integer,
  p_multiplier numeric DEFAULT NULL::numeric,
  p_requires_membership boolean DEFAULT NULL::boolean,
  p_sort_order integer DEFAULT NULL::integer,
  p_token_type text DEFAULT NULL::text,
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
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ADMIN_UPDATE_REWARD_RULE',
    jsonb_build_object(
      'area', 'tokens',
      'severity', 'info',
      'entity_type', 'token_reward_rule',
      'entity_id', p_rule_id
    )
  );

  UPDATE token_reward_rules
  SET
    action_name_key = COALESCE(p_action_name_key, action_name_key),
    action_type = COALESCE(p_action_type, action_type),
    base_amount = COALESCE(p_base_amount, base_amount),
    cooldown_hours = COALESCE(p_cooldown_hours, cooldown_hours),
    daily_limit = COALESCE(p_daily_limit, daily_limit),
    description_key = COALESCE(p_description_key, description_key),
    is_active = COALESCE(p_is_active, is_active),
    max_amount = COALESCE(p_max_amount, max_amount),
    membership_tier_required = COALESCE(p_membership_tier_required, membership_tier_required),
    min_amount = COALESCE(p_min_amount, min_amount),
    monthly_limit = COALESCE(p_monthly_limit, monthly_limit),
    multiplier = COALESCE(p_multiplier, multiplier),
    requires_membership = COALESCE(p_requires_membership, requires_membership),
    sort_order = COALESCE(p_sort_order, sort_order),
    token_type = COALESCE(p_token_type, token_type),
    weekly_limit = COALESCE(p_weekly_limit, weekly_limit),
    updated_at = NOW()
  WHERE id = p_rule_id
  RETURNING row_to_json(token_reward_rules)::jsonb INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_reward_rule_admin(uuid, text, text, numeric, integer, integer, text, boolean, numeric, text, numeric, integer, numeric, boolean, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_reward_rule_admin(uuid, text, text, numeric, integer, integer, text, boolean, numeric, text, numeric, integer, numeric, boolean, integer, text, integer) TO authenticated;
