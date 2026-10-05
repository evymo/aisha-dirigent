-- Materialized View: public.ai_agent_metrics_hourly
-- Description: Hourly pre-aggregated AI agent metrics from ai_trace_events.
-- Used by: get_ai_agent_metrics, get_ai_agent_metrics_timeseries, refresh_ai_agent_metrics
-- Source: Extracted from the absorbed migration (now in the baseline)

CREATE MATERIALIZED VIEW IF NOT EXISTS public.ai_agent_metrics_hourly AS
SELECT
  date_trunc('hour', ate.created_at) AS hour,
  ate.agent_slug,
  ate.event_type::text AS event_type,
  COUNT(*) AS total_events,
  AVG(ate.duration_ms)::int AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ate.duration_ms)::int AS p95_latency_ms,
  SUM(
    COALESCE((ate.cost_json->>'tokens_in')::int, 0) +
    COALESCE((ate.cost_json->>'tokens_out')::int, 0)
  ) AS total_tokens,
  SUM(COALESCE((ate.cost_json->>'usd')::numeric, 0))::numeric(12,4) AS total_cost,
  SUM(CASE WHEN ate.status = 'error' THEN 1 ELSE 0 END) AS errors,
  SUM(CASE WHEN ate.status = 'ok' THEN 1 ELSE 0 END) AS successes
FROM ai_trace_events ate
WHERE ate.agent_slug IS NOT NULL
GROUP BY 1, 2, 3;

-- Unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_metrics_hourly_pk
  ON ai_agent_metrics_hourly (hour, agent_slug, event_type);

-- Grants
-- ⛔ Jen služba (nález 2026-10-04): čtecí RPC get_ai_agent_metrics(_timeseries)
-- jsou DEFINER se stráží is_admin_or_staff(); přímý SELECT pro authenticated
-- ji obcházel a vydával náklady a latence agentů komukoli přihlášenému.
REVOKE ALL ON public.ai_agent_metrics_hourly FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_agent_metrics_hourly TO service_role;
