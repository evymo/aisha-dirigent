-- record_playwright_result
-- Service-role only: runner posts final counts + report path after Chromium exits.
-- Status derives from counts: failed>0 → 'failed', else if total>0 → 'passed', else 'errored'.
--
-- Production integration (migration 20260518040000):
--  • App-linked runs (app_name+active_slot set): update coolify_app_slots.{slot}_health.
--  • staging_auto + failed/errored + app-linked → auto-call request_rollback() (throttled by SoT).
--  • Story-linked runs (story_id set): emit qa_playwright_passed | qa_playwright_failed entry.

CREATE OR REPLACE FUNCTION public.record_playwright_result(
  p_run_id uuid,
  p_total integer,
  p_passed integer,
  p_failed integer,
  p_skipped integer,
  p_duration_ms integer,
  p_report_storage_path text,
  p_trace_json_path text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS public.playwright_run_status
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
  v_status public.playwright_run_status;
  v_run record;
  v_rollback_id uuid;
  v_should_rollback boolean := false;
  v_health text;
  v_slot_col text;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;

  SELECT id, status, trigger_kind, target_env, app_name, active_slot, story_id, requested_by
  INTO v_run FROM public.playwright_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id;
  END IF;
  IF v_run.status NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION 'Run in terminal state (%), cannot record', v_run.status;
  END IF;

  -- Status derivation: explicit error message wins, then counts.
  IF p_error_message IS NOT NULL AND p_total IS NULL THEN
    v_status := 'errored';
  ELSIF p_failed IS NOT NULL AND p_failed > 0 THEN
    v_status := 'failed';
  ELSIF p_total IS NOT NULL AND p_total > 0 THEN
    v_status := 'passed';
  ELSE
    v_status := 'errored';
  END IF;

  -- Update slot health when run is app-linked. Passed → healthy, failed/errored → degraded.
  IF v_run.app_name IS NOT NULL AND v_run.active_slot IS NOT NULL THEN
    v_health := CASE v_status WHEN 'passed' THEN 'healthy' ELSE 'degraded' END;
    v_slot_col := v_run.active_slot || '_health';
    EXECUTE format(
      'UPDATE public.coolify_app_slots SET %I = %L, updated_at = now() WHERE app_name = %L',
      v_slot_col, v_health, v_run.app_name
    );
  END IF;

  -- Auto-rollback path: staging_auto + failed/errored + app linked → request_rollback().
  -- request_rollback throttles to one open request per app per 30 min; we soft-fail on throttle.
  v_should_rollback := (
    v_run.trigger_kind = 'staging_auto'
    AND v_status IN ('failed', 'errored')
    AND v_run.app_name IS NOT NULL
  );
  IF v_should_rollback THEN
    BEGIN
      SELECT (public.request_rollback(
        v_run.app_name,
        'playwright_staging_auto',
        jsonb_build_object('run_id', p_run_id, 'failed', p_failed, 'error_message', p_error_message),
        NULL,
        jsonb_build_object('source', 'WF_PLAYWRIGHT_RUN', 'target_env', v_run.target_env)
      )).id INTO v_rollback_id;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_journal (user_id, action, metadata) VALUES (
        NULL, 'PLAYWRIGHT_RUN_ROLLBACK_THROTTLED',
        jsonb_build_object(
          'area', 'qa', 'severity', 'warning', 'entity_type', 'playwright_run',
          'entity_id', p_run_id::text, 'app_name', v_run.app_name,
          'error', SQLERRM,
          'tags', ARRAY['stack', 'qa', 'playwright', 'rollback', 'throttled']
        )
      );
    END;
  END IF;

  UPDATE public.playwright_runs
  SET status = v_status,
      total = p_total,
      passed = p_passed,
      failed = p_failed,
      skipped = p_skipped,
      duration_ms = p_duration_ms,
      report_storage_path = p_report_storage_path,
      trace_json_path = p_trace_json_path,
      error_message = p_error_message,
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      triggered_rollback_id = v_rollback_id,
      finished_at = now()
  WHERE id = p_run_id;

  -- Story entries: pass / fail block (mirrors web_artifact_applied / web_artifact_failed shape).
  IF v_run.story_id IS NOT NULL THEN
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (
      v_run.story_id,
      CASE v_status WHEN 'passed' THEN 'qa_playwright_passed' ELSE 'qa_playwright_failed' END,
      NULL,
      jsonb_build_object(
        'type', CASE v_status WHEN 'passed' THEN 'qa_playwright_passed' ELSE 'qa_playwright_failed' END,
        'run_id', p_run_id,
        'result_status', v_status::text,
        'total', p_total, 'passed', p_passed, 'failed', p_failed, 'skipped', p_skipped,
        'duration_ms', p_duration_ms,
        'report_storage_path', p_report_storage_path,
        'error_message', p_error_message,
        'app_name', v_run.app_name,
        'active_slot', v_run.active_slot,
        'rollback_id', v_rollback_id
      ),
      NULL
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    NULL,
    'PLAYWRIGHT_RUN_RESULT',
    jsonb_build_object(
      'area', 'qa',
      'severity', CASE WHEN v_status IN ('failed', 'errored') THEN 'warning' ELSE 'info' END,
      'entity_type', 'playwright_run',
      'entity_id', p_run_id::text,
      'trigger_kind', v_run.trigger_kind::text,
      'target_env', v_run.target_env,
      'app_name', v_run.app_name,
      'active_slot', v_run.active_slot,
      'story_id', v_run.story_id,
      'result_status', v_status::text,
      'counts', jsonb_build_object('total', p_total, 'passed', p_passed, 'failed', p_failed, 'skipped', p_skipped),
      'duration_ms', p_duration_ms,
      'triggered_rollback', v_rollback_id IS NOT NULL,
      'rollback_id', v_rollback_id,
      'tags', ARRAY['stack', 'qa', 'playwright', 'result', v_status::text]
    )
  );

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.record_playwright_result(uuid, integer, integer, integer, integer, integer, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_playwright_result(uuid, integer, integer, integer, integer, integer, text, text, text, jsonb) TO service_role;
