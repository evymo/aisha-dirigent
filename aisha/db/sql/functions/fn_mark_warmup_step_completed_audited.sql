-- ============================================================================
-- Source of Truth: fn_mark_warmup_step_completed_audited
-- Step:  Step W1 (Platform warmup wizard — admin onboarding into stack-default)
-- Used by: src/hooks/usePlatformWarmupState.ts → AdminWarmupWizard.tsx
-- Migration: aisha/db/migrations/20260520080000_platform_warmup_state.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_mark_warmup_step_completed_audited(
  p_step     text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin  boolean;
  v_user_id   uuid;
  v_audit_id  uuid;
BEGIN
  v_user_id := auth.uid();
  v_is_admin := public.is_admin_or_staff(v_user_id);

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required to mark warmup step'
      USING ERRCODE = '42501';
  END IF;

  IF p_step IS NULL OR p_step NOT IN ('welcome', 'kb_upload', 'rules_setup', 'test_query', 'complete') THEN
    RAISE EXCEPTION 'Unknown warmup step: %', p_step
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_journal (
    user_id, action, action_type, entity_type, area, severity, metadata
  ) VALUES (
    v_user_id,
    'warmup.step_completed',
    'warmup',
    'platform',
    'orchestration',
    'info',
    jsonb_build_object('step', p_step) || COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'audit_id',     v_audit_id,
    'step',         p_step,
    'recorded_by',  v_user_id,
    'recorded_at',  now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_mark_warmup_step_completed_audited(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_mark_warmup_step_completed_audited(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.fn_mark_warmup_step_completed_audited(text, jsonb) IS
  'Step W1: append one warmup.step_completed audit row. Admin/staff only. Step must be in {welcome, kb_upload, rules_setup, test_query, complete}.';
