-- Function: record_runtime_health_result
-- WF_RUNTIME_HEALTH_PROBE calls this after checking a runtime's reachability.
-- Updates ai_runtime_registry.adapter_health + adapter_health_checked_at +
-- consecutive_failure_count so fn_resolve_runtime can exclude a degraded/down
-- runtime AT RESOLVE TIME (it filters adapter_health IN ('healthy','unknown')) —
-- instead of the executor only failing loud later, at dispatch.
--
-- IMPORTANT: ai_runtime_registry.adapter_health is GLOBAL (shared across every
-- instance). It MUST be written by ONE dedicated probe that checks the SERVICE's
-- reachability — never from a single svc process's config-presence, which would
-- flip-flop the shared field between instances that do/don't hold a runtime's key.
--
-- Status enum (must match ai_runtime_registry.adapter_health CHECK):
--   healthy | degraded | down | unknown   (a probe should not set 'unknown').
--
-- Mirrors record_provider_health_result. Audits via audit_journal
-- action='runtime.health_probed' so operators can see probe history + gaps.
-- Service-role only. Idempotent.

CREATE OR REPLACE FUNCTION public.record_runtime_health_result(
  p_slug       text,
  p_status     text,
  p_latency_ms int  DEFAULT NULL,
  p_detail     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_runtime RECORD;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_slug IS NULL OR p_slug = '' THEN
    RAISE EXCEPTION 'p_slug required' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('healthy', 'degraded', 'down', 'unknown') THEN
    RAISE EXCEPTION 'Invalid p_status: % (allowed: healthy|degraded|down|unknown)', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_runtime
  FROM   ai_runtime_registry
  WHERE  slug = p_slug
  FOR    UPDATE;

  IF v_runtime IS NULL THEN
    RAISE EXCEPTION 'Runtime with slug % not found', p_slug USING ERRCODE = '22023';
  END IF;

  UPDATE ai_runtime_registry
  SET    adapter_health            = p_status,
         adapter_health_checked_at = now(),
         -- Exponential-backoff counter: increment on non-healthy probes, reset on
         -- healthy. get_runtimes_due_health_probe reads this to extend the probe
         -- interval for persistently-failing runtimes (5min → 1h → 6h → 24h).
         consecutive_failure_count = CASE
           WHEN p_status = 'healthy' THEN 0
           ELSE consecutive_failure_count + 1
         END,
         updated_at                = now()
  WHERE  slug = p_slug;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'runtime.health_probed',
    jsonb_build_object(
      'slug',           p_slug,
      'runtime_kind',   v_runtime.runtime_kind,
      'from_status',    v_runtime.adapter_health,
      'to_status',      p_status,
      'latency_ms',     p_latency_ms,
      'detail',         LEFT(COALESCE(p_detail, ''), 200),
      'status_changed', (v_runtime.adapter_health IS DISTINCT FROM p_status)
    )
  );

  RETURN jsonb_build_object(
    'slug',           p_slug,
    'from_status',    v_runtime.adapter_health,
    'to_status',      p_status,
    'status_changed', (v_runtime.adapter_health IS DISTINCT FROM p_status),
    'latency_ms',     p_latency_ms,
    'recorded_at',    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_runtime_health_result(text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_runtime_health_result(text, text, int, text) TO service_role;

COMMENT ON FUNCTION public.record_runtime_health_result(text, text, int, text) IS
  'WF_RUNTIME_HEALTH_PROBE result-recording RPC — updates ai_runtime_registry.adapter_health (the GLOBAL field fn_resolve_runtime filters on) + audits transitions. Service-role only.';
