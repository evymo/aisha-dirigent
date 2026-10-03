-- Function: get_my_distribution_history_audited
-- Returns user's distribution history with audit logging
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.get_my_distribution_history_audited()
RETURNS TABLE (
  carrier text,
  created_at timestamptz,
  delivered_at timestamptz,
  id uuid,
  scheduled_date date,
  shipped_at timestamptz,
  status text,
  study_id uuid,
  study_name text,
  tracking_number text,
  user_id uuid,
  vial_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, area, severity, summary)
  VALUES (auth.uid(), 'read', 'distribution_history', 'member', 'info', 'Member viewed distribution history');

  RETURN QUERY
  SELECT 
    uds.carrier,
    uds.created_at,
    uds.delivered_at,
    uds.id,
    uds.scheduled_date,
    uds.shipped_at,
    uds.status,
    uds.study_id,
    COALESCE(s.name, '') as study_name,
    uds.tracking_number,
    uds.user_id,
    uds.vial_count
  FROM user_distribution_schedule uds
  LEFT JOIN studies s ON s.id = uds.study_id
  WHERE uds.user_id = auth.uid()
  ORDER BY uds.scheduled_date DESC;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.get_my_distribution_history_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_distribution_history_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_distribution_history_audited() TO authenticated;
