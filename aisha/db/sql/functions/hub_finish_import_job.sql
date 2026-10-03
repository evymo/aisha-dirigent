-- ============================================================================
-- Source of Truth: hub_finish_import_job
-- Popis: Close an import job with final status + counts. service_role only.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627130000_hub_import_jobs.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_finish_import_job(
  p_job_id uuid, p_status text DEFAULT 'ok', p_snapshot_token text DEFAULT NULL,
  p_records_read int DEFAULT 0, p_records_upserted int DEFAULT 0,
  p_records_failed int DEFAULT 0, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN RAISE EXCEPTION 'Unauthorized: service_role required'; END IF;

  UPDATE public.hub_import_job SET
    finished_at = now(), status = p_status, snapshot_token = p_snapshot_token,
    records_read = p_records_read, records_upserted = p_records_upserted,
    records_failed = p_records_failed, error = p_error
  WHERE id = p_job_id;
END; $$;

REVOKE ALL ON FUNCTION public.hub_finish_import_job(uuid,text,text,int,int,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_finish_import_job(uuid,text,text,int,int,int,text) TO service_role;
