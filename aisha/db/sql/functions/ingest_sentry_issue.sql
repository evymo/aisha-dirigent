-- ============================================================================
-- Source of Truth: ingest_sentry_issue
-- Popis: Insert Sentry issue snapshot. Idempotent on (sentry_issue_id, observed_at).
--        Volaný z WF_SENTRY_INGEST nebo rozšířeného WF_SENTRY_MONITOR (po Sentry API call).
-- Volá: WF_SENTRY_INGEST, WF_SENTRY_MONITOR
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ingest_sentry_issue(p_payload jsonb)
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
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Idempotent: skip pokud existuje
  SELECT id INTO v_id
  FROM public.sentry_issue_snapshot
  WHERE sentry_issue_id = p_payload->>'sentry_issue_id'
    AND observed_at = (p_payload->>'observed_at')::timestamptz;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.sentry_issue_snapshot (
    sentry_issue_id, app_name, project_slug, level, title,
    first_seen, last_seen, count, user_count, status, release, permalink, metadata
  )
  VALUES (
    p_payload->>'sentry_issue_id',
    p_payload->>'app_name',
    p_payload->>'project_slug',
    COALESCE(p_payload->>'level', 'error'),
    COALESCE(p_payload->>'title', '(no title)'),
    (p_payload->>'first_seen')::timestamptz,
    COALESCE((p_payload->>'last_seen')::timestamptz, now()),
    COALESCE((p_payload->>'count')::int, 1),
    COALESCE((p_payload->>'user_count')::int, 0),
    COALESCE(p_payload->>'status', 'unresolved'),
    p_payload->>'release',
    p_payload->>'permalink',
    COALESCE(p_payload->'metadata', '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_sentry_issue(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_sentry_issue(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sentry_issue(jsonb) TO service_role;
