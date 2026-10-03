-- ============================================================================
-- Source of Truth: fn_get_runs_needing_graph_extract
-- Step:  Step 7.2 (Hippocampus Graph extraction worker)
-- Used by: services/svc-mcp-knowledge/src/routes/graph-extract.ts
-- Migration: aisha/db/migrations/20260520040000_graph_extraction_worker.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_runs_needing_graph_extract(
  p_batch_size     integer DEFAULT 20,
  p_max_age_hours  integer DEFAULT 168
)
RETURNS TABLE (
  run_id      uuid,
  kind        text,
  story_id    uuid,
  finished_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT ar.id, ar.kind, ar.story_id, ar.finished_at
    FROM public.ai_runs ar
   WHERE ar.status = 'succeeded'
     AND ar.finished_at IS NOT NULL
     AND ar.finished_at > now() - make_interval(hours => GREATEST(1, p_max_age_hours))
     AND NOT EXISTS (
       SELECT 1 FROM public.audit_journal aj
        WHERE aj.ai_run_id = ar.id
          AND aj.action = 'graph.extraction_completed'
     )
   ORDER BY ar.finished_at ASC
   LIMIT GREATEST(1, LEAST(200, p_batch_size));
$$;

REVOKE ALL ON FUNCTION public.fn_get_runs_needing_graph_extract(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_runs_needing_graph_extract(integer, integer) TO service_role;

COMMENT ON FUNCTION public.fn_get_runs_needing_graph_extract(integer, integer) IS
  'Step 7.2: returns succeeded ai_runs that have not yet been graph-extracted, oldest first. Bounded by max age (default 7d) so backfills do not re-extract historical runs.';
