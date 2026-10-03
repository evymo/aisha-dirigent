-- Function: public.create_token_reward_rule_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:52.519Z

CREATE OR REPLACE FUNCTION public.create_token_reward_rule_admin(p_action_key text, p_description text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_reward_amount numeric DEFAULT 0, p_sort_order integer DEFAULT 0, p_token_type text DEFAULT 'data'::text)
 RETURNS TABLE(action_name_key text, action_type text, base_amount numeric, cooldown_hours integer, created_at timestamptz, daily_limit integer, description_key text, id uuid, is_active boolean, max_amount numeric, membership_tier_required text, min_amount numeric, monthly_limit integer, multiplier numeric, requires_membership boolean, sort_order integer, token_type text, updated_at timestamptz, weekly_limit integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id uuid;
  v_action_name_key text;
  v_description_key text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;

  v_action_name_key := 'token_reward.' || p_action_key || '.action_name';
  v_description_key := 'token_reward.' || p_action_key || '.description';

  INSERT INTO token_reward_rules (
    action_type,
    action_name_key,
    description_key,
    token_type,
    base_amount,
    is_active,
    sort_order
  ) VALUES (
    p_action_key,
    v_action_name_key,
    v_description_key,
    p_token_type,
    p_reward_amount,
    p_is_active,
    p_sort_order
  )
  RETURNING token_reward_rules.id INTO v_new_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_new_id::text,
      p_entity_type := 'reward_rule',
      p_new_values := jsonb_build_object('action_key', p_action_key, 'amount', p_reward_amount),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Created reward rule: ' || p_action_key,
      p_tags := ARRAY['admin', 'tokens', 'reward', 'create'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    trr.action_name_key,
    trr.action_type,
    trr.base_amount,
    trr.cooldown_hours,
    trr.created_at::text,
    trr.daily_limit,
    trr.description_key,
    trr.id,
    trr.is_active,
    trr.max_amount,
    trr.membership_tier_required::text,
    trr.min_amount,
    trr.monthly_limit,
    trr.multiplier,
    trr.requires_membership,
    trr.sort_order,
    trr.token_type,
    trr.updated_at::text,
    trr.weekly_limit
  FROM token_reward_rules trr
  WHERE trr.id = v_new_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_token_reward_rule_admin(text, text, boolean, numeric, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_token_reward_rule_admin(text, text, boolean, numeric, integer, text) TO authenticated;

