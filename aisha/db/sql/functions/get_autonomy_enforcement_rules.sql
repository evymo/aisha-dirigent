-- Function: public.get_autonomy_enforcement_rules
-- Purpose: Returns the enforcement policy (approval, notification, escalation, audit)
--          for a given risk level (low/medium/high/critical).
--          Used by n8n workflows and AI agent runtime to enforce risk-to-autonomy policy.
-- Security: SECURITY DEFINER with search_path set.
-- Part of: Fáze 2 — Critical Gap Closure (risk-to-autonomy enforcement)

CREATE OR REPLACE FUNCTION public.get_autonomy_enforcement_rules(
  p_risk_level text
)
RETURNS TABLE (
  risk_level          text,
  requires_approval   boolean,
  auto_approve        boolean,
  notify_level        text,        -- 'none' | 'log_only' | 'dirigent' | 'expert'
  escalation_minutes  int,         -- 0 = no auto-escalation; >0 = escalate after N minutes
  audit_required      boolean,
  action_description  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only authenticated users or service_role may query enforcement rules
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to query enforcement rules';
  END IF;

  RETURN QUERY SELECT
    lower(p_risk_level)::text,
    CASE lower(p_risk_level)
      WHEN 'critical' THEN true
      WHEN 'high'     THEN true
      WHEN 'medium'   THEN false
      WHEN 'low'      THEN false
      ELSE true  -- deny-by-default: unknown risk requires approval
    END,
    CASE lower(p_risk_level)
      WHEN 'critical' THEN false
      WHEN 'high'     THEN false
      WHEN 'medium'   THEN true
      WHEN 'low'      THEN true
      ELSE false  -- deny-by-default: unknown risk NOT auto-approved
    END,
    CASE lower(p_risk_level)
      WHEN 'critical' THEN 'expert'::text
      WHEN 'high'     THEN 'expert'::text
      WHEN 'medium'   THEN 'dirigent'::text
      WHEN 'low'      THEN 'log_only'::text
      ELSE 'expert'::text  -- deny-by-default: unknown risk escalates to expert
    END,
    CASE lower(p_risk_level)
      WHEN 'critical' THEN 60
      WHEN 'high'     THEN 240
      WHEN 'medium'   THEN 0
      WHEN 'low'      THEN 0
      ELSE 60  -- deny-by-default: unknown risk auto-escalates in 60min
    END,
    CASE lower(p_risk_level)
      WHEN 'critical' THEN true
      WHEN 'high'     THEN true
      WHEN 'medium'   THEN true
      WHEN 'low'      THEN false
      ELSE true  -- deny-by-default: unknown risk requires audit
    END,
    CASE lower(p_risk_level)
      WHEN 'critical' THEN 'HARD STOP: Manual expert approval required. Auto-escalate after 60min. Full audit mandatory.'::text
      WHEN 'high'     THEN 'APPROVAL REQUIRED: Expert approval needed. Notify Dirigent + Expert. Auto-escalate after 4h.'::text
      WHEN 'medium'   THEN 'AUTO-APPROVE with notification: Notify Dirigent. Audit trail recorded.'::text
      WHEN 'low'      THEN 'AUTO-APPROVE: Log only. No explicit notification.'::text
      ELSE 'BLOCKED: Unknown risk level — deny-by-default. Requires expert approval + full audit.'::text
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_autonomy_enforcement_rules(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_autonomy_enforcement_rules(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_autonomy_enforcement_rules(text) TO service_role;
