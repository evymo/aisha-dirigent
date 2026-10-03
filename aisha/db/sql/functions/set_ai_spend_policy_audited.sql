-- ============================================================================
-- Source of Truth: set_ai_spend_policy_audited
-- Purpose: Upsert one spend policy row (the user-driven threshold matrix).
--          Passing all three thresholds NULL with p_deactivate=true retires
--          the row (is_active=false) — catalog defaults take over again.
-- Security: SECURITY DEFINER + is_admin_or_staff() guard + audit_journal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_ai_spend_policy_audited(
  p_scope_type           text DEFAULT 'global',
  p_scope_id             uuid DEFAULT NULL,
  p_task_kind            text DEFAULT NULL,
  p_auto_allow_under numeric DEFAULT NULL,
  p_ask_over         numeric DEFAULT NULL,
  p_deny_over        numeric DEFAULT NULL,
  p_deactivate           boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.ai_spend_policies%ROWTYPE;
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

  INSERT INTO public.ai_spend_policies (
    scope_type, scope_id, task_kind,
    auto_allow_under, ask_over, deny_over,
    is_active, created_by
  ) VALUES (
    p_scope_type, p_scope_id, NULLIF(btrim(COALESCE(p_task_kind, '')), ''),
    p_auto_allow_under, p_ask_over, p_deny_over,
    NOT COALESCE(p_deactivate, false), auth.uid()
  )
  ON CONFLICT (scope_type, scope_id, task_kind) DO UPDATE SET
    auto_allow_under = EXCLUDED.auto_allow_under,
    ask_over         = EXCLUDED.ask_over,
    deny_over        = EXCLUDED.deny_over,
    is_active            = EXCLUDED.is_active,
    updated_at           = now()
  RETURNING id, scope_type, scope_id, task_kind,
            auto_allow_under, ask_over, deny_over,
            is_active, created_by, created_at, updated_at
  INTO v_row;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ai.spend_policy.set',
    jsonb_strip_nulls(jsonb_build_object(
      'policy_id', v_row.id,
      'scope_type', v_row.scope_type,
      'scope_id', v_row.scope_id,
      'task_kind', v_row.task_kind,
      'auto_allow_under', v_row.auto_allow_under,
      'ask_over', v_row.ask_over,
      'deny_over', v_row.deny_over,
      'is_active', v_row.is_active
    ))
  );

  RETURN jsonb_build_object(
    'success', true,
    'policy_id', v_row.id,
    'is_active', v_row.is_active,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_spend_policy_audited(text, uuid, text, numeric, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ai_spend_policy_audited(text, uuid, text, numeric, numeric, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_spend_policy_audited(text, uuid, text, numeric, numeric, numeric, boolean) TO service_role;

COMMENT ON FUNCTION public.set_ai_spend_policy_audited(text, uuid, text, numeric, numeric, numeric, boolean) IS
  'Upsert one ai_spend_policies row (allow/ask/deny USD thresholds per scope×kind). Admin/staff, audited.';
