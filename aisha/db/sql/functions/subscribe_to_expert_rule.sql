-- Function: public.subscribe_to_expert_rule
-- Arguments: p_rule_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.subscribe_to_expert_rule(p_rule_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_was_active boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Rule must be published
  PERFORM 1 FROM expert_rules WHERE id = p_rule_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found or not published';
  END IF;

  -- Check if already subscribed (active)
  SELECT is_active INTO v_was_active
  FROM expert_rule_subscriptions
  WHERE user_id = v_caller_id AND rule_id = p_rule_id;

  IF v_was_active IS TRUE THEN
    -- Already subscribed — no-op
    RETURN true;
  END IF;

  INSERT INTO expert_rule_subscriptions (user_id, rule_id)
  VALUES (v_caller_id, p_rule_id)
  ON CONFLICT (user_id, rule_id) DO UPDATE SET is_active = true;

  -- Only increment when actually adding new/reactivated subscription
  UPDATE expert_rules SET subscriber_count = subscriber_count + 1
  WHERE id = p_rule_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_caller_id, 'EXPERT_RULE_SUBSCRIBE', jsonb_build_object(
    'area', 'knowledge', 'severity', 'info', 'rule_id', p_rule_id
  ));

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.subscribe_to_expert_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_to_expert_rule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscribe_to_expert_rule(uuid) TO service_role;
