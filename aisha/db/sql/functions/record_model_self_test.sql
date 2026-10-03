-- Function: record_model_self_test
-- The AUTOMATED self-test verdict for a discovered model — the missing transition
-- that closes the discover→self-test→moderate→resolve loop. After discovery upserts
-- a model as eval_status='pending', AISHA runs a smoke probe and calls this: it
-- records a benchmark row AND transitions eval_status to 'tested' (the model
-- responded) or 'rejected' (it failed). This is the system counterpart to the
-- admin-driven approve_model_admin / reject_model_admin.
--
-- Eligibility: 'pending'/'tested' are always re-testable. A 'rejected' model is
-- re-tested ONLY with p_force=true (an admin-triggered re-test, e.g. after a transient
-- provider outage) — so the boot self-test never silently re-promotes a rejected model.
-- An 'approved' verdict is NEVER overwritten. A benchmark row is always recorded (it
-- refreshes the score) even when the status is not eligible to change. service_role only.

-- p_force added → drop the old 7-arg signature so the overload does not linger.
DROP FUNCTION IF EXISTS public.record_model_self_test(uuid, text, boolean, numeric, integer, integer, text);

CREATE OR REPLACE FUNCTION public.record_model_self_test(
  p_model_registry_id uuid,
  p_task_type         text    DEFAULT 'smoke',
  p_passed            boolean DEFAULT false,
  p_overall           numeric DEFAULT NULL,
  p_avg_latency_ms    integer DEFAULT NULL,
  p_sample_count      integer DEFAULT 1,
  p_detail            text    DEFAULT NULL,
  p_force             boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_status text;
  v_new_status text;
  v_eligible   boolean;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '22023';
  END IF;
  IF p_model_registry_id IS NULL THEN
    RAISE EXCEPTION 'p_model_registry_id required' USING ERRCODE = '22023';
  END IF;

  SELECT eval_status INTO v_old_status FROM ai_model_registry WHERE id = p_model_registry_id FOR UPDATE;
  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Model % not found', p_model_registry_id USING ERRCODE = '22023';
  END IF;

  -- pending/tested always re-testable; rejected only under an explicit force;
  -- approved is NEVER auto-overwritten.
  v_eligible := v_old_status IN ('pending', 'tested') OR (v_old_status = 'rejected' AND p_force);

  -- Benchmark row — feeds the resolver's score-based ranking (recorded regardless).
  INSERT INTO ai_model_benchmarks (model_registry_id, task_type, overall_score, avg_latency_ms, success_rate, sample_count)
  VALUES (p_model_registry_id, p_task_type, p_overall, p_avg_latency_ms,
          CASE WHEN p_passed THEN 1.0 ELSE 0.0 END, COALESCE(p_sample_count, 1));

  v_new_status := CASE WHEN p_passed THEN 'tested' ELSE 'rejected' END;
  UPDATE ai_model_registry
  SET    eval_status = v_new_status, updated_at = now()
  WHERE  id = p_model_registry_id
    AND  v_eligible;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'model.self_tested', jsonb_build_object(
    'model_registry_id', p_model_registry_id::text, 'task_type', p_task_type,
    'passed', p_passed, 'overall', p_overall, 'from', v_old_status,
    'to', CASE WHEN v_eligible THEN v_new_status ELSE v_old_status END,
    'forced', p_force,
    'detail', LEFT(COALESCE(p_detail, ''), 200)
  ));

  RETURN jsonb_build_object(
    'model_registry_id', p_model_registry_id,
    'passed', p_passed,
    'from', v_old_status,
    'eval_status', CASE WHEN v_eligible THEN v_new_status ELSE v_old_status END,
    'admin_verdict_preserved', NOT v_eligible,
    'forced', p_force
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_model_self_test(uuid, text, boolean, numeric, integer, integer, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_model_self_test(uuid, text, boolean, numeric, integer, integer, text, boolean) TO service_role;

COMMENT ON FUNCTION public.record_model_self_test(uuid, text, boolean, numeric, integer, integer, text, boolean) IS
  'Automated model self-test verdict — records a benchmark + transitions eval_status pending/tested→tested|rejected; a rejected model re-tests only with p_force=true; approved is never overwritten. service_role only.';
