-- ============================================================================
-- Source of Truth: hub_recent_import_jobs
-- Popis: The processing queue for the cockpit (admin/staff) — recent import jobs
--        joined to the source name.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627130000_hub_import_jobs.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_recent_import_jobs(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid, source_slug text, source_name text, status text,
  started_at timestamptz, finished_at timestamptz, snapshot_token text,
  records_read int, records_upserted int, records_failed int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized: admin or staff required'; END IF;
  RETURN QUERY
    SELECT j.id, s.slug, s.display_name, j.status, j.started_at, j.finished_at,
           j.snapshot_token, j.records_read, j.records_upserted, j.records_failed, j.error
    FROM public.hub_import_job j
    JOIN public.hub_source s ON s.id = j.source_id
    ORDER BY j.started_at DESC
    LIMIT GREATEST(p_limit,1);
END; $$;

REVOKE ALL ON FUNCTION public.hub_recent_import_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_recent_import_jobs(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_recent_import_jobs(int) TO service_role;
