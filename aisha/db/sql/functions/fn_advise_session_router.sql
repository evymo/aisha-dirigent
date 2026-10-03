-- Function: fn_advise_session_router
-- Dirigent router-coach RPC. Given a session id + recent tool-uses array,
-- returns advisory output for the current dev session:
--   - rolling cost (USD over last 2h)
--   - read/write ratio (Read/Grep vs Edit/Write tools)
--   - batch-eligible count (analyze/summarize patterns in recent uses)
--   - suggested slot + suggested model + reasoning
--
-- ADVISORY-ONLY invariant: this never mutates session state. Pure read +
-- compute. Callers are .claude/hooks/* hooks (stderr only, exit 0).

CREATE OR REPLACE FUNCTION public.fn_advise_session_router(
  p_session_id text,
  p_recent_tool_uses jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_tool_count       int;
  v_read_count       int;
  v_batch_eligible_count int;
  v_read_ratio       numeric;
  v_rolling_cost     numeric;
  v_suggested_slot   text;
  v_suggested_model  text;
  v_suggested_profile text;
  v_reasoning        text;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_tool_count := COALESCE(jsonb_array_length(p_recent_tool_uses), 0);

  -- Tool-use shape: [{ tool, timestamp, input_tokens?, output_tokens? }, ...]
  -- read tools: Read, Grep, Glob, WebFetch, WebSearch
  -- batch-eligible patterns: analyze/summarize-style tool input.command
  IF v_tool_count > 0 THEN
    SELECT
      COUNT(*) FILTER (WHERE (t->>'tool')::text IN ('Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch')),
      COUNT(*) FILTER (
        WHERE (t->'input'->>'command')::text ~* '\y(analyz|summariz|aggregate|report|audit\s+last)\y'
           OR (t->>'tool')::text IN ('WebSearch', 'WebFetch')
      )
    INTO v_read_count, v_batch_eligible_count
    FROM jsonb_array_elements(p_recent_tool_uses) AS t;

    v_read_ratio := (v_read_count::numeric / v_tool_count::numeric);
  ELSE
    v_read_count := 0;
    v_batch_eligible_count := 0;
    v_read_ratio := 0.0;
  END IF;

  -- Rolling cost over last 2h for this session.
  -- ai_trace_events stores cost_json with a USD field per llmRouter convention.
  -- session_id may live in request_summary or response_summary (Dirigent writes
  -- whichever is available in fn_log_dev_signal). We accept either.
  SELECT COALESCE(SUM(
    COALESCE((cost_json->>'usd')::numeric, 0)
  ), 0)
  INTO v_rolling_cost
  FROM public.ai_trace_events
  WHERE created_at > now() - interval '2 hours'
    AND (
      (request_summary->>'session_id') = p_session_id
      OR (response_summary->>'session_id') = p_session_id
    );

  -- Suggested slot from read ratio
  v_suggested_slot := CASE
    WHEN v_read_ratio > 0.65 THEN 'spark'
    WHEN v_read_ratio < 0.30 THEN 'ember'
    ELSE 'default'
  END;

  -- Suggested profile: budget when cost > $0.50, balanced otherwise
  v_suggested_profile := CASE
    WHEN v_rolling_cost > 0.50 THEN 'budget'
    ELSE 'balanced'
  END;

  -- Suggested model: read-heavy + budget cap → flash; else keep current
  v_suggested_model := CASE
    WHEN v_rolling_cost > 0.50 AND v_suggested_slot = 'spark' THEN 'gemini-2.5-flash'
    WHEN v_rolling_cost > 0.50 THEN 'claude-haiku-4-20250514'
    ELSE NULL
  END;

  v_reasoning := format(
    'read_ratio=%.2f over %s tool_uses; rolling_cost=$%s; batch_eligible=%s/%s → slot=%s, profile=%s',
    v_read_ratio, v_tool_count, v_rolling_cost::text,
    v_batch_eligible_count, v_tool_count, v_suggested_slot, v_suggested_profile
  );

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'tool_count', v_tool_count,
    'read_count', v_read_count,
    'read_ratio', round(v_read_ratio, 3),
    'batch_eligible_count', v_batch_eligible_count,
    'rolling_cost', round(v_rolling_cost, 4),
    'suggested_slot', v_suggested_slot,
    'suggested_profile', v_suggested_profile,
    'suggested_model', v_suggested_model,
    'reasoning', v_reasoning
  );
END;
$$;

COMMENT ON FUNCTION public.fn_advise_session_router(text, jsonb) IS
  'Dirigent advisory router-coach: rolling cost + read/write ratio + batch '
  'eligibility from ai_trace_events for a session. Pure STABLE read; '
  'advisory-only — never mutates session state. Hooks consume via stderr.';

REVOKE ALL ON FUNCTION public.fn_advise_session_router(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_advise_session_router(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_advise_session_router(text, jsonb) TO service_role;
