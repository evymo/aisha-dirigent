-- Function: record_provider_health_result
-- WF_PROVIDER_HEALTH_PROBE calls this after fetching the provider's health
-- endpoint. Updates ai_provider_registry.last_health_{status,checked_at,detail}
-- so aisha_resolve_clow_backend's scoring can deprioritize degraded/down
-- providers in real time.
--
-- Status enum (must match ai_provider_registry CHECK constraint):
--   * healthy   — HTTP 2xx + parseable response + latency < 3s
--   * degraded  — HTTP 2xx but slow (>3s) OR partial response
--   * down      — HTTP 4xx/5xx OR network error
--   * unknown   — initial state; should NOT be set by this RPC (probe failed
--                 to even run → caller should record 'down' with detail)
--
-- Audits via audit_journal action='provider.health_probed' so operators can
-- see the probe history (and detect probe gaps if WF_PROVIDER_HEALTH_PROBE
-- itself goes down). Idempotent: writes always succeed, even if status
-- didn't change (latency_ms still useful for monitoring).

CREATE OR REPLACE FUNCTION public.record_provider_health_result(
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
  v_provider RECORD;
  v_user_id  uuid;
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

  SELECT * INTO v_provider
  FROM   ai_provider_registry
  WHERE  slug = p_slug
  FOR    UPDATE;

  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'Provider with slug % not found', p_slug USING ERRCODE = '22023';
  END IF;

  UPDATE ai_provider_registry
  SET    last_health_status     = p_status,
         last_health_checked_at = now(),
         last_health_detail     = LEFT(COALESCE(p_detail, ''), 500),
         -- Exponential-backoff counter: increment on non-healthy probes, reset
         -- on healthy. get_providers_due_health_probe reads this to extend
         -- the probe interval for persistently-failing providers (5min →
         -- 1h → 6h → 24h based on count).
         consecutive_failure_count = CASE
           WHEN p_status = 'healthy' THEN 0
           ELSE consecutive_failure_count + 1
         END,
         updated_at             = now()
  WHERE  slug = p_slug;

  -- Audit. Operators can query audit_journal for action='provider.health_probed'
  -- to see probe history (status transitions + latency trend) per provider.
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'provider.health_probed',
    jsonb_build_object(
      'slug',          p_slug,
      'backend_kind',  v_provider.backend_kind,
      'from_status',   v_provider.last_health_status,
      'to_status',     p_status,
      'latency_ms',    p_latency_ms,
      'detail',        LEFT(COALESCE(p_detail, ''), 200),
      'status_changed', (v_provider.last_health_status IS DISTINCT FROM p_status)
    )
  );

  RETURN jsonb_build_object(
    'slug',           p_slug,
    'from_status',    v_provider.last_health_status,
    'to_status',      p_status,
    'status_changed', (v_provider.last_health_status IS DISTINCT FROM p_status),
    'latency_ms',     p_latency_ms,
    'recorded_at',    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_provider_health_result(text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_provider_health_result(text, text, int, text) TO service_role;

COMMENT ON FUNCTION public.record_provider_health_result(text, text, int, text) IS
  'WF_PROVIDER_HEALTH_PROBE result-recording RPC — updates ai_provider_registry.last_health_* and audits status transitions. Service-role only.';
