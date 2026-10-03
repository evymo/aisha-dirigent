-- start_playwright_run
-- Creates a queued Playwright run targeting a deployed environment.
-- staging_auto: invoked by WF_DEPLOY_STORY after staging deploy (service_role).
-- production_manual: invoked by admin via webhook (sets approval_required=true,
--   runner waits until approve_playwright_run is called).
-- scheduled: cron-like, optional, follow-up.
--
-- Production integration (migration 20260518040000):
--   p_app_name → derive target_base_url from coolify_app_slots when 'auto', capture active_slot
--   p_story_id → emit qa_playwright_requested story_entry (mirrors web_artifact_upload)

CREATE OR REPLACE FUNCTION public.start_playwright_run(
  p_trigger_kind public.playwright_run_trigger,
  p_target_env text,
  p_target_base_url text,
  p_suite text DEFAULT 'all',
  p_deploy_ref text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_story_id uuid DEFAULT NULL,
  p_app_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
  v_is_service boolean;
  v_approval_required boolean;
  v_target_base_url text;
  v_active_slot text;
  v_resolved record;
BEGIN
  v_is_service := public.is_service_role();

  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or service_role required';
  END IF;

  IF p_target_env IS NULL OR p_target_env = '' THEN
    RAISE EXCEPTION 'target_env required';
  END IF;

  v_target_base_url := p_target_base_url;

  -- Derive from coolify_app_slots when caller wants live URL.
  IF p_app_name IS NOT NULL THEN
    SELECT * INTO v_resolved FROM public.resolve_deployed_url(p_app_name);
    IF v_resolved.target_base_url IS NOT NULL THEN
      v_active_slot := v_resolved.active_slot;
      IF v_target_base_url IS NULL OR v_target_base_url IN ('', 'auto') THEN
        v_target_base_url := v_resolved.target_base_url;
      END IF;
    ELSIF v_target_base_url IS NULL OR v_target_base_url IN ('', 'auto') THEN
      RAISE EXCEPTION 'app_name % has no live slot in coolify_app_slots; pass explicit target_base_url', p_app_name;
    END IF;
  END IF;

  IF v_target_base_url IS NULL OR v_target_base_url !~ '^https?://' THEN
    RAISE EXCEPTION 'target_base_url must be a valid http(s) URL (got %)', v_target_base_url;
  END IF;
  IF p_trigger_kind = 'staging_auto' AND NOT v_is_service THEN
    RAISE EXCEPTION 'staging_auto trigger requires service_role';
  END IF;

  -- production runs always need explicit approval.
  v_approval_required := (p_trigger_kind = 'production_manual');

  INSERT INTO public.playwright_runs (
    trigger_kind, target_env, target_base_url, suite, deploy_ref,
    status, approval_required, requested_by, metadata,
    app_name, active_slot, story_id
  ) VALUES (
    p_trigger_kind, p_target_env, v_target_base_url, p_suite, p_deploy_ref,
    'queued', v_approval_required, auth.uid(), COALESCE(p_metadata, '{}'::jsonb),
    p_app_name, v_active_slot, p_story_id
  )
  RETURNING id INTO v_run_id;

  -- Story-link the request so the storyloop chat reflects QA work.
  IF p_story_id IS NOT NULL THEN
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (
      p_story_id, 'qa_playwright_requested', NULL,
      jsonb_build_object(
        'type', 'qa_playwright_requested',
        'run_id', v_run_id,
        'trigger_kind', p_trigger_kind::text,
        'target_env', p_target_env,
        'target_base_url', v_target_base_url,
        'app_name', p_app_name,
        'active_slot', v_active_slot,
        'suite', p_suite,
        'deploy_ref', p_deploy_ref,
        'approval_required', v_approval_required
      ),
      auth.uid()
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PLAYWRIGHT_RUN_START',
    jsonb_build_object(
      'area', 'qa',
      'severity', 'info',
      'entity_type', 'playwright_run',
      'entity_id', v_run_id::text,
      'trigger_kind', p_trigger_kind::text,
      'target_env', p_target_env,
      'target_base_url', v_target_base_url,
      'approval_required', v_approval_required,
      'app_name', p_app_name,
      'active_slot', v_active_slot,
      'story_id', p_story_id,
      'tags', ARRAY['stack', 'qa', 'playwright', p_trigger_kind::text]
    )
  );

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_playwright_run(public.playwright_run_trigger, text, text, text, text, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_playwright_run(public.playwright_run_trigger, text, text, text, text, jsonb, uuid, text) TO authenticated, service_role;
