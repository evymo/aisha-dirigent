-- Get pending account deletion request for current user

CREATE OR REPLACE FUNCTION get_my_account_deletion_request()
RETURNS TABLE (
  id UUID,
  requested_at TIMESTAMPTZ,
  scheduled_deletion_at TIMESTAMPTZ,
  reason TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  RETURN QUERY
  SELECT 
    adr.id,
    adr.requested_at,
    adr.scheduled_deletion_at,
    adr.reason,
    adr.status::TEXT
  FROM account_deletion_requests adr
  WHERE adr.user_id = v_user_id
  AND adr.status = 'pending'
  ORDER BY adr.requested_at DESC
  LIMIT 1;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION get_my_account_deletion_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_account_deletion_request() TO authenticated;

COMMENT ON FUNCTION get_my_account_deletion_request() IS 
'Returns the current users pending account deletion request if any.';
