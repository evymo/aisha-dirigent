-- Function: public.fn_detect_agent_runaway
-- Description: GOAL 2 — the autonomous supervisor analysis pass. Scans LIVE agent
--   sessions (agent_live_sessions × ai_trace_events cost rollup) and, for any run
--   over the runtime / token / cost thresholds, queues a Dirigent nudge (advisory,
--   drained on the next hook by the relay). Idempotent per session within the
--   nudge window. Thresholds are ARGUMENTS (operator/config-driven — no policy
--   baked as a literal). Returns the number of nudges created.
--   Closes the plan's GOAL 2 (something actually analyses the ingested activity)
--   and the "Automatický supervisor trigger" (driven by WF_DIRIGENT_AGENT_WATCHDOG).
-- Security: SECURITY DEFINER, read-mostly + queue insert. service_role + authenticated.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_detect_agent_runaway(integer, bigint, numeric);

CREATE OR REPLACE FUNCTION public.fn_detect_agent_runaway(
  p_max_runtime_minutes int     DEFAULT 15,
  p_max_tokens          bigint  DEFAULT NULL,
  p_max_cost        numeric DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count    int := 0;
  v_row      record;
  v_reason   text;
  v_user_id  uuid := auth.uid();
BEGIN
  -- Supervisor-scope: this pass enumerates ALL users' live sessions, so it is
  -- restricted to admins/staff and the service_role watchdog. A regular
  -- authenticated caller must not be able to scan other users' agent activity.
  -- Robust allow-list (COALESCE guards the NULL-role / NULL-uid edges).
  IF NOT (
       COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
       OR COALESCE(public.is_admin_or_staff(v_user_id), false)
     )
  THEN
    RAISE EXCEPTION 'fn_detect_agent_runaway requires admin/staff or service_role'
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    -- Cost rollup uses the SAME canonical predicate as list_active_agent_sessions
    -- and finish_ai_run: ai_trace_events.run_id = the session's per-session ai_run
    -- (agent_live_sessions.ai_run_id). Joining on session_id via request_summary
    -- would be fragile (relays don't guarantee that key) and silently zero-out the
    -- token/cost thresholds.
    SELECT s.session_id,
           s.story_id,
           s.source,
           s.agent_run_id,
           (EXTRACT(EPOCH FROM (now() - s.started_at)) / 60)::int AS runtime_min,
           COALESCE(tc.tokens, 0) AS tokens,
           COALESCE(tc.usd, 0)    AS cost
    FROM public.agent_live_sessions s
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE((ate.cost_json->>'tokens_in')::bigint, 0)
               + COALESCE((ate.cost_json->>'tokens_out')::bigint, 0)) AS tokens,
             SUM(COALESCE((ate.cost_json->>'usd')::numeric, 0))       AS usd
      FROM public.ai_trace_events ate
      WHERE ate.run_id = s.ai_run_id
    ) tc ON s.ai_run_id IS NOT NULL
    WHERE s.current_phase <> 'stopped'
      AND s.updated_at > now() - interval '2 hours'   -- ignore stale rows
  LOOP
    -- Threshold check (first breached dimension wins the message).
    v_reason := NULL;
    IF v_row.runtime_min >= p_max_runtime_minutes THEN
      v_reason := format('running %s min with no Stop', v_row.runtime_min);
    ELSIF p_max_tokens IS NOT NULL AND v_row.tokens >= p_max_tokens THEN
      v_reason := format('%s tokens used (>= %s)', v_row.tokens, p_max_tokens);
    ELSIF p_max_cost IS NOT NULL AND v_row.cost >= p_max_cost THEN
      v_reason := format('$%s spent (>= $%s)', v_row.cost, p_max_cost);
    END IF;
    IF v_reason IS NULL THEN CONTINUE; END IF;

    -- Idempotent: one live watchdog nudge per session within the window.
    IF EXISTS (
      SELECT 1 FROM public.dirigent_nudges n
      WHERE n.event_origin = 'agent_watchdog'
        AND n.consumed_at IS NULL
        AND n.expires_at > now()
        AND n.metadata->>'session_id' = v_row.session_id
    ) THEN CONTINUE; END IF;

    INSERT INTO public.dirigent_nudges (story_id, event_origin, severity, message, metadata, expires_at)
    VALUES (
      v_row.story_id,
      'agent_watchdog',
      'warn',
      format('Agent session %s (%s) %s — consider checking in or stopping the run.',
             v_row.session_id, v_row.source, v_reason),
      jsonb_build_object(
        'session_id', v_row.session_id,
        'agent_run_id', v_row.agent_run_id,
        'runtime_min', v_row.runtime_min,
        'tokens', v_row.tokens,
        'cost', v_row.cost),
      now() + interval '1 hour'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) TO authenticated;

COMMENT ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) IS
  'GOAL 2 autonomous supervisor pass: scans live agent_live_sessions x ai_trace_events cost rollup; queues a Dirigent nudge (event_origin=agent_watchdog) for runs over the runtime/token/cost thresholds, idempotent per session. Returns nudge count. Driven by n8n WF_DIRIGENT_AGENT_WATCHDOG.';
