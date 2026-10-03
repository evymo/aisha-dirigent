-- ============================================================================
-- Source of Truth: set_ai_risk_policy_audited
-- Purpose: Upsert one ai_risk_policies row — the user-driven risk-threshold
--          matrix that decides governance for a task of a given kind:
--            evaluated risk <= auto_allow_at_or_below → allow (silent)
--            evaluated risk >  ask_above              → ask (human approval)
--            evaluated risk >  deny_above             → deny (hard ceiling)
--          Risk levels are the fixed ordinal scale returned by
--          fn_evaluate_proposal_risk(): 'low' < 'medium' < 'high' < 'critical'.
--          This is the risk-governance mirror of set_ai_spend_policy_audited
--          (USD thresholds): governance = POLICY thresholds computed against the
--          clow's risk, NOT a maintained roster of permitted entities.
--          Resolution (most specific active row wins) and the catalog fallback
--          live in ai_risk_policies (table SoT) + the reader RPC.
-- Security: SECURITY DEFINER + is_admin_or_staff() guard + audit_journal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_ai_risk_policy_audited(
  p_auto_allow_at_or_below text,
  p_ask_above              text,
  p_deny_above             text,
  p_scope_type             text    DEFAULT 'global',
  p_scope_id               uuid    DEFAULT NULL,
  p_task_kind              text    DEFAULT NULL,
  p_is_active              boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_policy_id uuid;
  v_task_kind text;
  -- Fixed ordinal risk scale (the value's own domain type, not an editable
  -- allow-list): rank(level) lets us validate membership + threshold ordering
  -- without any maintained list of permitted things.
  v_allow_rank int;
  v_ask_rank   int;
  v_deny_rank  int;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- JIT-provision the admin actor so the audit_journal insert below can't
  -- FK-violate (23503) for a Keycloak admin created after bootstrap import.
  PERFORM public.ensure_current_user();

  IF p_scope_type NOT IN ('global', 'story', 'partner') THEN
    RAISE EXCEPTION 'Invalid scope_type: %', p_scope_type USING ERRCODE = '22023';
  END IF;
  IF (p_scope_type = 'global') <> (p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'scope_id must be NULL for global scope and set otherwise'
      USING ERRCODE = '22023';
  END IF;

  -- Map each threshold onto the fixed risk scale. Anything off the scale is
  -- rejected — the scale is invariant, so there is nothing to maintain here.
  v_allow_rank := CASE p_auto_allow_at_or_below
    WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END;
  v_ask_rank := CASE p_ask_above
    WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END;
  v_deny_rank := CASE p_deny_above
    WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END;

  IF v_allow_rank IS NULL OR v_ask_rank IS NULL OR v_deny_rank IS NULL THEN
    RAISE EXCEPTION 'Risk thresholds must be one of low|medium|high|critical (got allow=%, ask=%, deny=%)',
      p_auto_allow_at_or_below, p_ask_above, p_deny_above USING ERRCODE = '22023';
  END IF;

  -- allow_at_or_below <= ask_above <= deny_above (mirror of the spend-policy
  -- threshold-order invariant, expressed over the ordinal risk rank).
  IF v_allow_rank > v_ask_rank OR v_ask_rank > v_deny_rank THEN
    RAISE EXCEPTION 'Risk thresholds out of order: allow(%) <= ask(%) <= deny(%) required',
      p_auto_allow_at_or_below, p_ask_above, p_deny_above USING ERRCODE = '22023';
  END IF;

  v_task_kind := NULLIF(btrim(COALESCE(p_task_kind, '')), '');

  INSERT INTO public.ai_risk_policies (
    scope_type, scope_id, task_kind,
    auto_allow_at_or_below, ask_above, deny_above,
    is_active, created_by
  ) VALUES (
    p_scope_type, p_scope_id, v_task_kind,
    p_auto_allow_at_or_below, p_ask_above, p_deny_above,
    COALESCE(p_is_active, true), auth.uid()
  )
  ON CONFLICT (scope_type, scope_id, task_kind) DO UPDATE SET
    auto_allow_at_or_below = EXCLUDED.auto_allow_at_or_below,
    ask_above              = EXCLUDED.ask_above,
    deny_above             = EXCLUDED.deny_above,
    is_active              = EXCLUDED.is_active,
    updated_at             = now()
  RETURNING id INTO v_policy_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'risk_policy_set',
    jsonb_strip_nulls(jsonb_build_object(
      'policy_id', v_policy_id,
      'scope_type', p_scope_type,
      'scope_id', p_scope_id,
      'task_kind', v_task_kind,
      'auto_allow_at_or_below', p_auto_allow_at_or_below,
      'ask_above', p_ask_above,
      'deny_above', p_deny_above,
      'is_active', COALESCE(p_is_active, true)
    ))
  );

  RETURN v_policy_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_risk_policy_audited(text, text, text, text, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ai_risk_policy_audited(text, text, text, text, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_risk_policy_audited(text, text, text, text, uuid, text, boolean) TO service_role;

COMMENT ON FUNCTION public.set_ai_risk_policy_audited(text, text, text, text, uuid, text, boolean) IS
  'Upsert one ai_risk_policies row (allow/ask/deny risk-level thresholds per scope×task-kind). Admin/staff, audited (risk_policy_set).';
