-- ============================================================================
-- Source of Truth: hub_start_import_job
-- Popis: Open a 'running' import job for a source (by slug). service_role only.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627130000_hub_import_jobs.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_start_import_job(p_source_slug text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_source_id uuid; v_id uuid; v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN RAISE EXCEPTION 'Unauthorized: service_role required'; END IF;

  SELECT id INTO v_source_id FROM public.hub_source WHERE slug = p_source_slug;
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'Unknown hub_source slug: %', p_source_slug; END IF;

  INSERT INTO public.hub_import_job (source_id, status)
  VALUES (v_source_id, 'running')
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.hub_start_import_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_start_import_job(text) TO service_role;
