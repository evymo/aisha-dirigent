-- ============================================================================
-- Source of Truth: fn_estimate_task_cost
-- Purpose: Pre-flight cost estimate for a task kind — answers "co to může
--          stát" BEFORE a run starts. Two-source strategy:
--            history  — p50/p90 percentiles of ai_runs.cost_total_json
--                       (finished runs of the same kind, 30-day window,
--                       optionally narrowed to the story) when >= 5 samples;
--            catalog  — ai_cost_class_catalog band as the cold-start
--                       fallback (new platform / new kind / sparse history).
--          Estimates self-correct as history accumulates — no model needed.
-- Security: SECURITY DEFINER, read-only. authenticated + service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_estimate_task_cost(
  p_kind     text,
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p50       numeric;
  v_p90       numeric;
  v_n         int;
  v_catalog   public.ai_cost_class_catalog%ROWTYPE;
  v_source    text;
  v_tokens_p90 numeric;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR btrim(p_kind) = '' THEN
    RAISE EXCEPTION 'fn_estimate_task_cost: p_kind required' USING ERRCODE = '22023';
  END IF;

  -- History percentiles: finished runs of this kind, last 30 days. Story
  -- narrowing is intentionally soft — story-local history is preferred only
  -- when it alone clears the sample threshold.
  SELECT
    percentile_cont(0.5) WITHIN GROUP (ORDER BY usd),
    percentile_cont(0.9) WITHIN GROUP (ORDER BY usd),
    percentile_cont(0.9) WITHIN GROUP (ORDER BY toks),
    COUNT(*)::int
  INTO v_p50, v_p90, v_tokens_p90, v_n
  FROM (
    SELECT
      NULLIF(ar.cost_total_json->>'total', '')::numeric AS usd,
      (COALESCE(NULLIF(ar.cost_total_json->>'tokens_input', '')::numeric, 0)
       + COALESCE(NULLIF(ar.cost_total_json->>'tokens_output', '')::numeric, 0)) AS toks
    FROM public.ai_runs ar
    WHERE ar.kind = p_kind
      AND ar.finished_at IS NOT NULL
      AND ar.finished_at > now() - interval '30 days'
      AND (p_story_id IS NULL OR ar.story_id = p_story_id)
      AND NULLIF(ar.cost_total_json->>'total', '')::numeric > 0
  ) s;

  -- Story-scoped query too sparse → widen to platform-wide history.
  IF p_story_id IS NOT NULL AND COALESCE(v_n, 0) < 5 THEN
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY usd),
      percentile_cont(0.9) WITHIN GROUP (ORDER BY usd),
      percentile_cont(0.9) WITHIN GROUP (ORDER BY toks),
      COUNT(*)::int
    INTO v_p50, v_p90, v_tokens_p90, v_n
    FROM (
      SELECT
        NULLIF(ar.cost_total_json->>'total', '')::numeric AS usd,
        (COALESCE(NULLIF(ar.cost_total_json->>'tokens_input', '')::numeric, 0)
         + COALESCE(NULLIF(ar.cost_total_json->>'tokens_output', '')::numeric, 0)) AS toks
      FROM public.ai_runs ar
      WHERE ar.kind = p_kind
        AND ar.finished_at IS NOT NULL
        AND ar.finished_at > now() - interval '30 days'
        AND NULLIF(ar.cost_total_json->>'total', '')::numeric > 0
    ) s;
  END IF;

  IF COALESCE(v_n, 0) >= 5 THEN
    v_source := 'history';
  ELSE
    SELECT * INTO v_catalog
    FROM public.ai_cost_class_catalog c
    WHERE c.kind = p_kind AND c.is_active;
    IF v_catalog.kind IS NOT NULL THEN
      v_source     := 'catalog';
      v_p50        := v_catalog.usd_p50;
      v_p90        := v_catalog.usd_p90;
      v_tokens_p90 := v_catalog.tokens_p90;
    ELSE
      -- Unknown kind with no history: explicitly say so — the authorizer
      -- treats 'none' as ask-worthy rather than silently allowing.
      v_source := 'none';
      v_p50    := NULL;
      v_p90    := NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'source', v_source,
    'n_samples', COALESCE(v_n, 0),
    'usd_p50', v_p50,
    'usd_p90', v_p90,
    'tokens_p90', v_tokens_p90,
    'cost_class', v_catalog.cost_class
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_estimate_task_cost(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_estimate_task_cost(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_estimate_task_cost(text, uuid) TO service_role;

COMMENT ON FUNCTION public.fn_estimate_task_cost(text, uuid) IS
  'Pre-flight cost estimate per task kind: 30d ai_runs percentiles (>=5 samples) with ai_cost_class_catalog fallback. Returns {source: history|catalog|none, usd_p50, usd_p90, tokens_p90, n_samples}.';
