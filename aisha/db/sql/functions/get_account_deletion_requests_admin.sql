-- Admin: list all account deletion requests with user info

CREATE OR REPLACE FUNCTION get_account_deletion_requests_admin(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  display_name TEXT,
  reason TEXT,
  feedback TEXT,
  requested_at TIMESTAMPTZ,
  scheduled_deletion_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT,
  processed_by UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Authorization: admin or staff only
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ADMIN_VIEW_DELETION_REQUESTS',
    jsonb_build_object(
      'area', 'admin',
      'severity', 'info',
      'limit', p_limit,
      'offset', p_offset,
      'status_filter', p_status
    )
  );
  
  RETURN QUERY
  SELECT
    adr.id,
    adr.user_id,
    au.email::TEXT AS user_email,
    COALESCE(p.display_name, au.email::TEXT) AS display_name,
    adr.reason,
    adr.feedback,
    adr.requested_at,
    adr.scheduled_deletion_at,
    adr.cancelled_at,
    adr.completed_at,
    adr.status::TEXT,
    adr.processed_by
  FROM account_deletion_requests adr
  JOIN aisha_auth.users au ON au.id = adr.user_id
  LEFT JOIN profiles p ON p.id = adr.user_id
  WHERE (p_status IS NULL OR adr.status::TEXT = p_status)
  ORDER BY
    CASE adr.status
      WHEN 'pending' THEN 0
      WHEN 'cancelled' THEN 1
      WHEN 'completed' THEN 2
    END,
    adr.requested_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION get_account_deletion_requests_admin(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_account_deletion_requests_admin(integer, integer, text) TO authenticated;

COMMENT ON FUNCTION get_account_deletion_requests_admin(integer, integer, text) IS
'Admin audited function to list all account deletion requests with user info. Sorted by status priority (pending first) then by date.';
