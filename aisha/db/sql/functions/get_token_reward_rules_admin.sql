-- Function: public.get_token_reward_rules_admin
-- Arguments: (none)
-- Description: Returns token reward rules for admin. Uses _key for translations, no hardcoded locale columns.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_token_reward_rules_admin()
 RETURNS TABLE(action_name_key text, action_type text, base_amount numeric, cooldown_hours integer, created_at timestamptz, daily_limit integer, description_key text, id uuid, is_active boolean, max_amount numeric, membership_tier_required text, min_amount numeric, monthly_limit integer, multiplier numeric, requires_membership boolean, sort_order integer, token_type text, updated_at timestamptz, weekly_limit integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'tokens'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_reward_rule',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read token reward rule',
      p_tags := ARRAY['admin', 'token_reward_rule'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    trr.action_name_key,
    trr.action_type,
    COALESCE(trr.base_amount, 0)::integer,
    COALESCE(trr.cooldown_hours, 0)::integer,
    trr.created_at::text,
    trr.daily_limit::integer,
    trr.description_key,
    trr.id,
    trr.is_active,
    trr.max_amount::integer,
    trr.membership_tier_required::text,
    trr.min_amount::integer,
    trr.monthly_limit::integer,
    COALESCE(trr.multiplier, 1)::numeric,
    COALESCE(trr.requires_membership, false),
    COALESCE(trr.sort_order, 0)::integer,
    trr.token_type,
    trr.updated_at::text,
    trr.weekly_limit::integer
  FROM token_reward_rules trr
  ORDER BY trr.sort_order, trr.action_type;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_reward_rules_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_reward_rules_admin() TO authenticated;
