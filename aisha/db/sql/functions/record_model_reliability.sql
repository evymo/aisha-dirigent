-- Function: public.record_model_reliability  —  L1 REPLACE writer for ai_model_reliability
-- Upserts exactly one CURRENT reliability row per (model_registry_id, normalized task_kind).
-- Mirrors record_model_benchmark's REPLACE discipline, but targets the SEPARATE reliability table
-- so reactive telemetry never touches the curated quality benchmarks the resolver ranks on.
-- service_role (rollup/cron) or admin/staff only. Returns the row id.

CREATE OR REPLACE FUNCTION public.record_model_reliability(
  p_model_registry_id uuid,
  p_task_kind         text,
  p_sample_count      bigint  DEFAULT 0,
  p_success_rate      numeric DEFAULT NULL,
  p_error_rate        numeric DEFAULT NULL,
  p_avg_latency_ms    integer DEFAULT NULL,
  p_p95_latency_ms    integer DEFAULT NULL,
  p_avg_cost_per_call numeric DEFAULT NULL,
  p_avg_eval_score    numeric DEFAULT NULL,
  p_window_hours      integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_norm text;
  v_id   uuid;
BEGIN
  -- NULL-safe fail-closed guard (parity with fn_get_decision_outcomes / fn_rollup / fn_observe):
  -- is_service_role() returns a non-null boolean and is_admin_or_staff is COALESCEd, so an absent
  -- claim can never leave the predicate NULL (which would skip the RAISE and fail OPEN).
  IF NOT (public.is_service_role() OR COALESCE(public.is_admin_or_staff(auth.uid()), false)) THEN
    RAISE EXCEPTION 'Not authorized: service_role or admin/staff required' USING ERRCODE = '42501';
  END IF;
  IF p_model_registry_id IS NULL OR p_task_kind IS NULL THEN
    RAISE EXCEPTION 'p_model_registry_id + p_task_kind required' USING ERRCODE = '22023';
  END IF;

  v_norm := public.normalize_task_kind(p_task_kind);

  INSERT INTO public.ai_model_reliability (
    model_registry_id, task_kind, sample_count, success_rate, error_rate,
    avg_latency_ms, p95_latency_ms, avg_cost_per_call, avg_eval_score, window_hours, measured_at
  ) VALUES (
    p_model_registry_id, v_norm, GREATEST(p_sample_count, 0), p_success_rate, p_error_rate,
    p_avg_latency_ms, p_p95_latency_ms, p_avg_cost_per_call, p_avg_eval_score, p_window_hours, now()
  )
  ON CONFLICT (model_registry_id, task_kind) DO UPDATE SET
    sample_count      = EXCLUDED.sample_count,
    success_rate      = EXCLUDED.success_rate,
    error_rate        = EXCLUDED.error_rate,
    avg_latency_ms    = EXCLUDED.avg_latency_ms,
    p95_latency_ms    = EXCLUDED.p95_latency_ms,
    avg_cost_per_call = EXCLUDED.avg_cost_per_call,
    avg_eval_score    = EXCLUDED.avg_eval_score,
    window_hours      = EXCLUDED.window_hours,
    measured_at       = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.record_model_reliability(uuid, text, bigint, numeric, numeric, integer, integer, numeric, numeric, integer) IS
  'L1 REPLACE writer for ai_model_reliability (one current row per model+normalized task_kind). Reactive telemetry sink, separate from ai_model_benchmarks. service_role/admin only.';

REVOKE ALL ON FUNCTION public.record_model_reliability(uuid, text, bigint, numeric, numeric, integer, integer, numeric, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_model_reliability(uuid, text, bigint, numeric, numeric, integer, integer, numeric, numeric, integer) TO service_role;
