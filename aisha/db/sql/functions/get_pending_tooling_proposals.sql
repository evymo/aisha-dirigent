-- ============================================================================
-- Source of Truth: get_pending_tooling_proposals
-- Popis: Read-only query pending tooling proposals pro Phase 4 dashboard.
--        Vrací stručný list (id, kind, name, path, occurrence_count, age_minutes,
--        manual_locked, bundle_id) — bez full content (load on-demand).
-- Volá: dashboard "Pending Proposals" widget
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_tooling_proposals(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id                uuid,
  proposed_at       timestamptz,
  proposal_kind     text,
  artifact_name     text,
  artifact_path     text,
  occurrence_count  int,
  age_minutes       int,
  manual_locked     boolean,
  proposal_bundle_id uuid
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
    p.id, p.proposed_at, p.proposal_kind, p.artifact_name, p.artifact_path,
    p.occurrence_count,
    EXTRACT(EPOCH FROM (now() - p.proposed_at))::int / 60 AS age_minutes,
    p.manual_locked,
    p.proposal_bundle_id
  FROM public.aisha_tooling_proposals p
  WHERE p.approval_status = 'pending'
  ORDER BY p.proposed_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_tooling_proposals(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_tooling_proposals(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_tooling_proposals(int) TO service_role;
