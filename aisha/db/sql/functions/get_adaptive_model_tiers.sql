-- Function: get_adaptive_model_tiers
-- Two-phase adaptive model tier selection (benchmark-based or heuristic).
-- Source: migration 20260418130100_cost_intelligence_and_hippocampus.sql
--
-- odysseus impl 03: the payload additionally carries `windows` —
--   { "<model_id>": { "context_window": int|null, "max_output_tokens": int|null } }
-- for every distinct tier model, so the chat path can enforce the input-token
-- budget from ai_model_registry (ONE window source, impl/08 §5) without a new
-- RPC. Additive + backward compatible: existing consumers read only the tier
-- keys. NULL window = consumer keeps today's behavior (no trimming).

CREATE OR REPLACE FUNCTION public.get_adaptive_model_tiers(
  p_task_type text DEFAULT 'chat'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB := '{}'::jsonb;
  v_model TEXT;
  v_has_benchmarks BOOLEAN;
BEGIN
  -- Two-phase adaptive selection:
  --   Phase A: Use ai_model_benchmarks data (post-evaluation)
  --   Phase B: Use heuristics from ai_model_registry (pre-eval)

  SELECT EXISTS(
    SELECT 1 FROM ai_model_benchmarks b
    JOIN ai_model_registry r ON r.id = b.model_registry_id
    WHERE r.is_available AND NOT r.is_deprecated AND r.is_chat_capable
      AND (r.eval_status <> 'rejected' OR r.is_admin_active)  -- moderation: exclude admin-rejected (unless force-activated)
      AND b.task_type = p_task_type AND b.overall_score IS NOT NULL
  ) INTO v_has_benchmarks;

  IF v_has_benchmarks THEN
    -- PHASE A: BENCHMARK-BASED SELECTION

    -- greeting + simple: cheapest model with acceptable quality (score >= 0.6)
    SELECT r.model_id INTO v_model
    FROM ai_model_registry r
    JOIN ai_model_benchmarks b ON b.model_registry_id = r.id
    WHERE r.is_available AND NOT r.is_deprecated AND r.is_chat_capable
      AND (r.eval_status <> 'rejected' OR r.is_admin_active)  -- moderation: exclude admin-rejected (unless force-activated)
      AND NOT r.is_reasoning AND b.task_type = p_task_type
      AND COALESCE(b.overall_score, 0) >= 0.6
    ORDER BY b.avg_cost_per_call ASC NULLS LAST, b.overall_score DESC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('greeting', v_model, 'simple', v_model);
    END IF;

    -- moderate: balanced quality/cost
    SELECT r.model_id INTO v_model
    FROM ai_model_registry r
    JOIN ai_model_benchmarks b ON b.model_registry_id = r.id
    WHERE r.is_available AND NOT r.is_deprecated AND r.is_chat_capable
      AND (r.eval_status <> 'rejected' OR r.is_admin_active)  -- moderation: exclude admin-rejected (unless force-activated)
      AND NOT r.is_reasoning AND b.task_type = p_task_type
    ORDER BY (COALESCE(b.overall_score, 0) * 0.6 - COALESCE(b.avg_cost_per_call, 0) * 0.4) DESC
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('moderate', v_model);
    END IF;

    -- complex: highest quality non-reasoning
    SELECT r.model_id INTO v_model
    FROM ai_model_registry r
    JOIN ai_model_benchmarks b ON b.model_registry_id = r.id
    WHERE r.is_available AND NOT r.is_deprecated AND r.is_chat_capable
      AND (r.eval_status <> 'rejected' OR r.is_admin_active)  -- moderation: exclude admin-rejected (unless force-activated)
      AND NOT r.is_reasoning AND b.task_type = p_task_type
    ORDER BY b.overall_score DESC NULLS LAST, b.avg_latency_ms ASC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('complex', v_model);
    END IF;

    -- deep_analysis: highest quality reasoning model
    SELECT r.model_id INTO v_model
    FROM ai_model_registry r
    JOIN ai_model_benchmarks b ON b.model_registry_id = r.id
    WHERE r.is_available AND NOT r.is_deprecated AND r.is_chat_capable
      AND (r.eval_status <> 'rejected' OR r.is_admin_active)  -- moderation: exclude admin-rejected (unless force-activated)
      AND r.is_reasoning AND b.task_type = p_task_type
    ORDER BY b.overall_score DESC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('deep_analysis', v_model);
    END IF;

  ELSE
    -- PHASE B: HEURISTIC SELECTION (price-based)
    --
    -- Heuristic cost estimates ($/M tokens) by model name pattern:
    --   nano = 0.05, flash/haiku = 0.10, mini = 0.50,
    --   standard = 3.0, pro/opus/ultra = 15.0
    --
    -- Dated variants (e.g. gpt-4o-2024-11-20) are excluded to prefer
    -- canonical model names. Transcription models are also excluded.

    -- greeting + simple: cheapest available non-reasoning model
    SELECT model_id INTO v_model FROM ai_model_registry
    WHERE is_available AND NOT is_deprecated AND is_chat_capable AND NOT is_reasoning
      AND model_id !~ '-\d{4}-\d{2}(-\d{2})?$'
      AND model_id !~* 'transcrib|diariz|realtime|search'
    ORDER BY
      COALESCE(input_price_per_m, CASE
        WHEN model_id ~* 'nano' THEN 0.05
        WHEN model_id ~* 'flash|haiku' THEN 0.10
        WHEN model_id ~* 'mini' THEN 0.50
        WHEN model_id ~* 'pro|opus|ultra' THEN 15.0
        ELSE 3.0
      END) ASC,
      latest_eval_score DESC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('greeting', v_model, 'simple', v_model);
    END IF;

    -- moderate: mid-tier non-reasoning (closest to ~$1/M tokens)
    SELECT model_id INTO v_model FROM ai_model_registry
    WHERE is_available AND NOT is_deprecated AND is_chat_capable AND NOT is_reasoning
      AND model_id !~ '-\d{4}-\d{2}(-\d{2})?$'
      AND model_id !~* 'transcrib|diariz|realtime|search'
    ORDER BY
      ABS(COALESCE(input_price_per_m, CASE
        WHEN model_id ~* 'nano' THEN 0.05
        WHEN model_id ~* 'flash|haiku' THEN 0.10
        WHEN model_id ~* 'mini' THEN 0.50
        WHEN model_id ~* 'pro|opus|ultra' THEN 15.0
        ELSE 3.0
      END) - 1.0) ASC,
      latest_eval_score DESC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('moderate', v_model);
    END IF;

    -- complex: highest-tier non-reasoning
    SELECT model_id INTO v_model FROM ai_model_registry
    WHERE is_available AND NOT is_deprecated AND is_chat_capable AND NOT is_reasoning
      AND model_id !~ '-\d{4}-\d{2}(-\d{2})?$'
      AND model_id !~* 'transcrib|diariz|realtime|search'
    ORDER BY
      COALESCE(input_price_per_m, CASE
        WHEN model_id ~* 'nano' THEN 0.05
        WHEN model_id ~* 'flash|haiku' THEN 0.10
        WHEN model_id ~* 'mini' THEN 0.50
        WHEN model_id ~* 'pro|opus|ultra' THEN 15.0
        ELSE 3.0
      END) DESC,
      latest_eval_score DESC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('complex', v_model);
    END IF;

    -- deep_analysis: best reasoning model
    SELECT model_id INTO v_model FROM ai_model_registry
    WHERE is_available AND NOT is_deprecated AND is_chat_capable AND is_reasoning
      AND model_id !~ '-\d{4}-\d{2}(-\d{2})?$'
      AND model_id !~* 'transcrib|diariz|realtime|search'
    ORDER BY
      COALESCE(input_price_per_m, CASE
        WHEN model_id ~* 'nano' THEN 0.05
        WHEN model_id ~* 'flash|haiku' THEN 0.10
        WHEN model_id ~* 'mini' THEN 0.50
        WHEN model_id ~* 'pro|opus|ultra' THEN 15.0
        ELSE 3.0
      END) DESC,
      latest_eval_score DESC NULLS LAST
    LIMIT 1;
    IF v_model IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('deep_analysis', v_model);
    END IF;

  END IF;

  -- odysseus impl 03: attach registry windows for the chosen tier models
  -- (budget enforcement source — additive `windows` key, never breaks old readers).
  IF v_result <> '{}'::jsonb THEN
    v_result := v_result || jsonb_build_object('windows', COALESCE((
      SELECT jsonb_object_agg(
               r.model_id,
               jsonb_build_object(
                 'context_window', r.context_window,
                 'max_output_tokens', r.max_output_tokens
               )
             )
      FROM ai_model_registry r
      WHERE r.model_id IN (
        SELECT DISTINCT value #>> '{}'
        FROM jsonb_each(v_result - 'windows')
        WHERE jsonb_typeof(value) = 'string'
      )
    ), '{}'::jsonb));
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION get_adaptive_model_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_adaptive_model_tiers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_adaptive_model_tiers(text) TO service_role;
