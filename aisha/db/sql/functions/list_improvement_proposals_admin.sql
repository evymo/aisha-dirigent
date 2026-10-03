-- list_improvement_proposals_admin: List AI improvement proposals with filtering
-- Called by: mcp-knowledge-server/index.ts, admin UI hooks
-- Source: migration 20260418130000_fix_self_improvement_foundation.sql
CREATE OR REPLACE FUNCTION public.list_improvement_proposals_admin(
  p_agent_slug text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  agent_slug text,
  anomaly_key text,
  applied_at timestamptz,
  category text,
  created_at timestamptz,
  current_value jsonb,
  description text,
  metadata jsonb,
  priority integer,
  proposal_type text,
  proposed_value jsonb,
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  risk_level text,
  status text,
  title text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    ip.id,
    ip.agent_slug,
    ip.anomaly_key,
    ip.applied_at,
    ip.category,
    ip.created_at,
    ip.current_value,
    ip.description,
    ip.metadata,
    ip.priority,
    ip.proposal_type,
    ip.proposed_value,
    ip.review_note,
    ip.reviewed_at,
    ip.reviewed_by,
    ip.risk_level,
    ip.status,
    ip.title,
    ip.updated_at
  FROM improvement_proposals ip
  WHERE (p_status IS NULL OR ip.status = p_status)
    AND (p_agent_slug IS NULL OR ip.agent_slug = p_agent_slug)
  ORDER BY ip.priority DESC, ip.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_improvement_proposals_admin(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_improvement_proposals_admin(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_improvement_proposals_admin(text, integer, text) TO service_role;
