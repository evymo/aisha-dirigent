-- Function: public.update_token_reward_rule_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:54.732Z

CREATE OR REPLACE FUNCTION public.update_token_reward_rule_admin(p_id uuid, p_conditions jsonb DEFAULT NULL::jsonb, p_description text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_reward_amount numeric DEFAULT NULL::numeric, p_sort_order integer DEFAULT NULL::integer)
 RETURNS TABLE(action_name_key text, action_type text, base_amount numeric, cooldown_hours integer, created_at timestamptz, daily_limit integer, description_key text, id uuid, is_active boolean, max_amount numeric, membership_tier_required text, min_amount numeric, monthly_limit integer, multiplier numeric, requires_membership boolean, sort_order integer, token_type text, updated_at timestamptz, weekly_limit integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;

  UPDATE token_reward_rules trr
  SET 
    base_amount = COALESCE(p_reward_amount, trr.base_amount),
    is_active = COALESCE(p_is_active, trr.is_active),
    sort_order = COALESCE(p_sort_order, trr.sort_order),
    updated_at = now()
  WHERE trr.id = p_id;

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
  WHERE trr.id = p_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'tokens'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_reward_rule',
      p_new_values := jsonb_build_object('id', p_id, 'conditions', p_conditions, 'description', p_description, 'is_active', p_is_active, 'reward_amount', p_reward_amount),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated token reward rule',
      p_tags := ARRAY['admin', 'token_reward_rule', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_token_reward_rule_admin(uuid, jsonb, text, boolean, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_token_reward_rule_admin(uuid, jsonb, text, boolean, numeric, integer) TO authenticated;

