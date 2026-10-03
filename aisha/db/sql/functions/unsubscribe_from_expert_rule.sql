-- Function: public.unsubscribe_from_expert_rule
-- Arguments: p_rule_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.unsubscribe_from_expert_rule(p_rule_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE expert_rule_subscriptions SET is_active = false
  WHERE user_id = v_caller_id AND rule_id = p_rule_id;

  IF FOUND THEN
    UPDATE expert_rules SET subscriber_count = GREATEST(subscriber_count - 1, 0)
    WHERE id = p_rule_id;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.unsubscribe_from_expert_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_from_expert_rule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_from_expert_rule(uuid) TO service_role;
