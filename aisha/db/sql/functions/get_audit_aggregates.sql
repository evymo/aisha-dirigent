-- ============================================================================
-- Source of Truth: get_audit_aggregates
-- Popis: Pattern detection helper pro WF_AISHA_TOOLING_OBSERVER. Vrátí akce
--        s ≥ p_min_occurrences výskyty v posledních p_window_days dnech, group
--        by action. Computes success_rate (heuristic: action ending in '_failed'/'_error'
--        = failure) a vrací sample recent metadata (latest occurrence per action).
-- Volá: WF_AISHA_TOOLING_OBSERVER (META-2)
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_audit_aggregates(
  p_window_days int DEFAULT 7,
  p_min_occurrences int DEFAULT 5
)
RETURNS TABLE (
  action            text,
  occurrence_count  int,
  unique_users      int,
  success_rate      numeric,
  recent_metadata   jsonb,
  first_seen        timestamptz,
  last_seen         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    aj.action,
    count(*)::int AS occurrence_count,
    count(DISTINCT aj.user_id)::int AS unique_users,
    -- success_rate via heuristic — actions ending in '_failed', '_error' = failure
    (
      count(*) FILTER (
        WHERE aj.action !~ '_(failed|error|aborted|rejected)$'
      )::numeric / NULLIF(count(*), 0)::numeric
    ) AS success_rate,
    -- Sample of metadata (most recent occurrence)
    (
      SELECT aj2.metadata
      FROM public.audit_journal aj2
      WHERE aj2.action = aj.action
      ORDER BY aj2.created_at DESC
      LIMIT 1
    ) AS recent_metadata,
    min(aj.created_at) AS first_seen,
    max(aj.created_at) AS last_seen
  FROM public.audit_journal aj
  WHERE aj.created_at > now() - (p_window_days || ' days')::interval
  GROUP BY aj.action
  HAVING count(*) >= p_min_occurrences
  ORDER BY count(*) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_aggregates(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_aggregates(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_aggregates(int, int) TO service_role;
