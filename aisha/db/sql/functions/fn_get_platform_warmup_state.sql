-- ============================================================================
-- Source of Truth: fn_get_platform_warmup_state
-- Step:  Step W1 (Platform warmup wizard — admin onboarding into stack-default)
-- Used by: src/hooks/usePlatformWarmupState.ts → AdminWarmupWizard.tsx
-- Migration: aisha/db/migrations/20260520080000_platform_warmup_state.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_platform_warmup_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_is_service       boolean;
  v_is_admin         boolean;
  v_default_story_id uuid;
  v_completed_steps  text[];
  v_last_step        text;
  v_last_step_at     timestamptz;
  v_kb_count         int;
  v_needs_warmup     boolean;
BEGIN
  v_is_service := public.is_service_role();
  v_is_admin := public.is_admin_or_staff(auth.uid());

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or service_role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_default_story_id
    FROM public.partner_stories
   WHERE is_stack_default = true
   LIMIT 1;

  SELECT
    COALESCE(array_agg(DISTINCT (aj.metadata->>'step') ORDER BY (aj.metadata->>'step')),
             ARRAY[]::text[]),
    (SELECT aj2.metadata->>'step'
       FROM public.audit_journal aj2
      WHERE aj2.action = 'warmup.step_completed'
      ORDER BY aj2.created_at DESC
      LIMIT 1),
    (SELECT aj2.created_at
       FROM public.audit_journal aj2
      WHERE aj2.action = 'warmup.step_completed'
      ORDER BY aj2.created_at DESC
      LIMIT 1)
  INTO v_completed_steps, v_last_step, v_last_step_at
  FROM public.audit_journal aj
  WHERE aj.action = 'warmup.step_completed'
    AND aj.metadata ? 'step';

  IF v_default_story_id IS NOT NULL THEN
    SELECT count(*) INTO v_kb_count
      FROM public.knowledge_items ki
     WHERE ki.story_id = v_default_story_id
       AND ki.status = 'active'
       AND (ki.quarantine_status IS NULL
            OR ki.quarantine_status NOT IN ('flagged', 'quarantined'));
  ELSE
    v_kb_count := 0;
  END IF;

  v_needs_warmup := NOT ('complete' = ANY(v_completed_steps));

  RETURN jsonb_build_object(
    'needs_warmup',             v_needs_warmup,
    'default_story_id',         v_default_story_id,
    'completed_steps',          to_jsonb(v_completed_steps),
    'last_step',                v_last_step,
    'last_step_at',             v_last_step_at,
    'default_story_kb_count',   v_kb_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_platform_warmup_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_platform_warmup_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_platform_warmup_state() TO service_role;

COMMENT ON FUNCTION public.fn_get_platform_warmup_state() IS
  'Step W1: read-only warmup state derived from audit_journal warmup.step_completed rows + live stack-default KB count. Admin/staff or service_role only.';
