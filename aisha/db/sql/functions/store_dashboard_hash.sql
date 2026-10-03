-- ============================================================================
-- Source of Truth: store_dashboard_hash
-- Popis: Insert nový render record. Volat po každém pokusu o build (i když skipnutý).
--        Validuje publish_status a triggered_by enum.
-- Volá: WF_APPSMITH_DASHBOARD_BUILDER po importu / skipu / failure
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.store_dashboard_hash(
  p_content_hash    text,
  p_triggered_by    text,
  p_publish_status  text,
  p_dashboard_slug  text DEFAULT 'aisha-ops',
  p_appsmith_app_id text DEFAULT NULL,
  p_diff_summary    jsonb DEFAULT NULL,
  p_publish_error   text DEFAULT NULL,
  p_duration_ms     int DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '22023';
  END IF;

  IF p_publish_status NOT IN ('pending', 'published', 'skipped_no_change', 'failed') THEN
    RAISE EXCEPTION 'Invalid publish_status: %', p_publish_status USING ERRCODE = '22023';
  END IF;
  IF p_triggered_by NOT IN ('cron_30min', 'manual_webhook', 'first_bootstrap', 'force_rebuild') THEN
    RAISE EXCEPTION 'Invalid triggered_by: %', p_triggered_by USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.dashboard_render_history (
    dashboard_slug, content_hash, triggered_by, diff_summary,
    appsmith_app_id, publish_status, publish_error, duration_ms, metadata
  )
  VALUES (
    p_dashboard_slug, p_content_hash, p_triggered_by, p_diff_summary,
    p_appsmith_app_id, p_publish_status, p_publish_error, p_duration_ms, p_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.store_dashboard_hash(text, text, text, text, text, jsonb, text, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_dashboard_hash(text, text, text, text, text, jsonb, text, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_dashboard_hash(text, text, text, text, text, jsonb, text, int, jsonb) TO service_role;
