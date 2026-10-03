-- =============================================================================
-- Function: get_adapters_for_context
-- Purpose: Find best-matching LoRA adapters for a given org/domain/task context
-- Part of: AISHA Learning Engine (ALE) — Phase 2 prep (routing extension)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_adapters_for_context(
  p_domain_tags text[] DEFAULT '{}'::text[],
  p_limit integer DEFAULT 5,
  p_min_eval_score numeric DEFAULT 0.6,
  p_org_id uuid DEFAULT NULL,
  p_task_type text DEFAULT NULL
)
RETURNS TABLE (
  adapter_id uuid,
  adapter_path text,
  adapter_type text,
  base_model_id text,
  display_name text,
  domain_match_score numeric,
  eval_score numeric,
  model_id text,
  org_id uuid,
  provider text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    amr.id AS adapter_id,
    amr.adapter_path,
    amr.adapter_type,
    parent.model_id AS base_model_id,
    amr.display_name,
    -- Score: tag overlap (0-1) normalized
    CASE
      WHEN array_length(p_domain_tags, 1) IS NULL OR array_length(p_domain_tags, 1) = 0 THEN 0.5::numeric
      ELSE (
        SELECT count(*)::numeric / array_length(p_domain_tags, 1)::numeric
        FROM unnest(amr.domain_tags) dt
        WHERE dt = ANY(p_domain_tags)
      )
    END AS domain_match_score,
    COALESCE(amr.latest_eval_score, 0)::numeric AS eval_score,
    amr.model_id,
    amr.org_id,
    amr.provider
  FROM public.ai_model_registry amr
  LEFT JOIN public.ai_model_registry parent ON parent.id = amr.parent_model_id
  WHERE amr.adapter_type IS NOT NULL
    AND amr.is_available = true
    AND amr.is_deprecated = false
    AND (p_org_id IS NULL OR amr.org_id IS NULL OR amr.org_id = p_org_id)
    AND COALESCE(amr.latest_eval_score, 0) >= p_min_eval_score
  ORDER BY
    -- Prefer org-specific adapters
    (CASE WHEN amr.org_id = p_org_id THEN 1 ELSE 0 END) DESC,
    -- Then by domain match score
    (CASE
      WHEN array_length(p_domain_tags, 1) IS NULL OR array_length(p_domain_tags, 1) = 0 THEN 0.5
      ELSE (
        SELECT count(*)::numeric / array_length(p_domain_tags, 1)::numeric
        FROM unnest(amr.domain_tags) dt
        WHERE dt = ANY(p_domain_tags)
      )
    END) DESC,
    -- Then by eval score
    COALESCE(amr.latest_eval_score, 0) DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_adapters_for_context(text[], integer, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_adapters_for_context(text[], integer, numeric, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.get_adapters_for_context(text[], integer, numeric, uuid, text) IS
  'Find best-matching LoRA adapters for a given org/domain context. Used by route_task() Phase 4 adapter resolution.';
