-- ============================================================================
-- Source of Truth: fn_log_agent_session_event
-- Purpose: Record one agent-session event into ai_trace_events (the universal
--          telemetry signal) keyed by the session's ide_session ai_run —
--          NOT into a parallel per-source event table. Mapping:
--            tool_use            → event_type 'tool_call'
--            subagents_snapshot  → event_type 'task_checkpoint'
--          session_id rides in request_summary (indexed:
--          idx_ai_trace_events_session_id_request), so fn_advise_session_router
--          and the anomaly/performance readers see IDE activity natively.
--          Side effect: maintains agent_live_sessions.subagents for Agent
--          tool pre/post events (server-side accumulation, capped at 20).
-- Callers: dirigent-supervisor route (service_role), extension (authenticated).
-- Security: SECURITY DEFINER + REVOKE/GRANT. Fail-soft: unknown session → NULL
--           (caller relays are fire-and-forget fail-open).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_log_agent_session_event(
  p_session_id text,
  p_event_kind text,
  p_tool_name  text  DEFAULT NULL,
  p_file_path  text  DEFAULT NULL,
  p_payload    jsonb DEFAULT '{}'::jsonb,
  p_cost       jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session    public.agent_live_sessions%ROWTYPE;
  v_event_type ai_event_type;
  v_event_id   uuid;
  v_agent_phase text;
  v_label      text;
  v_subagents  jsonb;
  v_idx        int;
  v_entry      jsonb;
  v_is_service boolean :=
    (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  v_caller     uuid := auth.uid();
BEGIN
  -- Auth: service_role (dirigent relay backend) or an authenticated user.
  IF NOT v_is_service AND v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'fn_log_agent_session_event: p_session_id required'
      USING ERRCODE = '22023';
  END IF;

  v_event_type := CASE p_event_kind
    WHEN 'tool_use'           THEN 'tool_call'::ai_event_type
    WHEN 'subagents_snapshot' THEN 'task_checkpoint'::ai_event_type
    ELSE NULL
  END;
  IF v_event_type IS NULL THEN
    RAISE EXCEPTION 'fn_log_agent_session_event: unknown event_kind %', p_event_kind
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.agent_live_sessions
  WHERE session_id = p_session_id;

  -- Fail-soft: relay callers are fail-open fire-and-forget; an event arriving
  -- before the session upsert (race) is dropped rather than erroring.
  IF v_session.id IS NULL OR v_session.ai_run_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ownership: non-service callers may log only into their own sessions.
  IF NOT v_is_service
     AND v_session.user_id IS NOT NULL
     AND v_session.user_id <> v_caller THEN
    RAISE EXCEPTION 'Not authorized for session %', p_session_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ai_trace_events
    (run_id, event_type, agent_slug, operation, status, cost_json,
     request_summary, response_summary)
  VALUES (
    v_session.ai_run_id,
    v_event_type,
    'ide:' || v_session.source,
    COALESCE(p_tool_name, p_event_kind),
    'ok',
    p_cost,
    jsonb_strip_nulls(jsonb_build_object(
      'session_id', p_session_id,
      'source', v_session.source,
      'story_id', v_session.story_id,
      'file_path', p_file_path,
      'branch', v_session.branch
    )),
    COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('session_id', p_session_id)
  )
  RETURNING id INTO v_event_id;

  -- Server-side sub-agent accumulation: the Claude Code relay only sees
  -- Agent tool pre/post hook events; the live subagents snapshot is derived
  -- here so every UI consumer reads one canonical column.
  IF p_tool_name = 'Agent' THEN
    v_agent_phase := COALESCE(p_payload->>'phase', 'pre');
    v_label := COALESCE(
      NULLIF(btrim(p_payload->>'label'), ''),
      'agent'
    );
    v_subagents := COALESCE(v_session.subagents, '[]'::jsonb);

    IF v_agent_phase = 'pre' THEN
      v_subagents := v_subagents || jsonb_build_array(jsonb_build_object(
        'label', v_label,
        'status', 'running',
        'started_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ));
      -- Cap at the most recent 20 entries.
      IF jsonb_array_length(v_subagents) > 20 THEN
        SELECT jsonb_agg(elem) INTO v_subagents
        FROM (
          SELECT elem
          FROM jsonb_array_elements(v_subagents) WITH ORDINALITY AS t(elem, ord)
          ORDER BY t.ord
          OFFSET jsonb_array_length(v_subagents) - 20
        ) trimmed;
      END IF;
    ELSE
      -- post: mark the most recent running entry with this label completed.
      FOR v_idx IN REVERSE jsonb_array_length(v_subagents) - 1 .. 0 LOOP
        v_entry := v_subagents -> v_idx;
        IF v_entry->>'status' = 'running'
           AND (v_entry->>'label' = v_label OR v_label = 'agent') THEN
          v_subagents := jsonb_set(
            v_subagents,
            ARRAY[v_idx::text],
            v_entry || jsonb_build_object(
              'status', 'completed',
              'ended_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
          );
          EXIT;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.agent_live_sessions
    SET subagents = v_subagents, updated_at = now()
    WHERE id = v_session.id;
  END IF;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_log_agent_session_event(text, text, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_log_agent_session_event(text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_agent_session_event(text, text, text, text, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_log_agent_session_event(text, text, text, text, jsonb, jsonb) IS
  'Logs one agent-session event into ai_trace_events (tool_use→tool_call, subagents_snapshot→task_checkpoint) via the session''s ide_session ai_run; maintains agent_live_sessions.subagents from Agent tool pre/post events. Fail-soft NULL on unknown session.';
