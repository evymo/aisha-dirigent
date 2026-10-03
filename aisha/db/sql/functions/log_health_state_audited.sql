-- Function: log_health_state_audited
-- Logs a health state entry and awards tokens
-- Security: DEFINER with audit trail
-- Created: 2026-01-17
-- Updated: 2026-01-20 - Added token rewards
-- Updated: 2026-02-09 - Added p_ended_at for symptom duration tracking

CREATE OR REPLACE FUNCTION public.log_health_state_audited(
  p_ended_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_severity integer DEFAULT NULL,
  p_started_at timestamptz DEFAULT now(),
  p_state_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_reward_rule record;
  v_tokens_earned int := 0;
  v_token_type text := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_state_id IS NULL OR p_severity IS NULL THEN
    RAISE EXCEPTION 'p_state_id and p_severity are required';
  END IF;

  -- Verify ownership
  IF NOT EXISTS(SELECT 1 FROM member_health_states WHERE id = p_state_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Health state not found or not owned';
  END IF;

  INSERT INTO member_health_logs (user_id, state_id, severity, started_at, ended_at, notes, logged_at)
  VALUES (auth.uid(), p_state_id, p_severity, p_started_at, p_ended_at, p_notes, now())
  RETURNING id INTO v_id;

  -- Update health state with last logged time
  UPDATE member_health_states
  SET last_logged_at = now(), current_severity = p_severity
  WHERE id = p_state_id;

  -- Award tokens based on reward rules (use health_log action type)
  SELECT * INTO v_reward_rule FROM token_reward_rules 
  WHERE action_type = 'health_log' AND is_active = true LIMIT 1;
  
  -- Fallback to dosing_log if health_log doesn't exist
  IF v_reward_rule IS NULL THEN
    SELECT * INTO v_reward_rule FROM token_reward_rules 
    WHERE action_type = 'dosing_log' AND is_active = true LIMIT 1;
  END IF;
  
  IF v_reward_rule IS NOT NULL THEN
    v_token_type := v_reward_rule.token_type;
    v_tokens_earned := COALESCE(v_reward_rule.base_amount * v_reward_rule.multiplier, 0)::int;
    
    IF v_tokens_earned > 0 THEN
      PERFORM award_tokens(
        auth.uid(),
        v_reward_rule.token_type,
        v_tokens_earned,
        'health_log',
        v_id,
        format('Health state log: severity %s', p_severity)
      );
    END IF;
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'create', 'member_health_log', v_id::text, 'member', 'info', 
          format('Logged health state with severity %s (+%s tokens)', p_severity, v_tokens_earned));

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_id,
    'tokens_earned', v_tokens_earned,
    'token_type', v_token_type
  );
END;
$$;

-- Permissions: sensitive data function - authenticated only, no anon access
REVOKE ALL ON FUNCTION public.log_health_state_audited(timestamptz, text, integer, timestamptz, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_health_state_audited(timestamptz, text, integer, timestamptz, uuid) TO authenticated;

COMMENT ON FUNCTION public.log_health_state_audited(timestamptz, text, integer, timestamptz, uuid) IS 
'Logs a health state entry with severity and optional ended_at. Awards tokens. Audited.';
