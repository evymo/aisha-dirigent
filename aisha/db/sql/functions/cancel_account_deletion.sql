-- Cancel a pending account deletion request
-- User can cancel the deletion within the 30-day grace period

CREATE OR REPLACE FUNCTION cancel_account_deletion()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_request_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Find pending deletion request
  SELECT id INTO v_request_id
  FROM account_deletion_requests
  WHERE user_id = v_user_id
  AND status = 'pending'
  ORDER BY requested_at DESC
  LIMIT 1;
  
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'No pending deletion request found';
  END IF;
  
  -- Cancel the request
  UPDATE account_deletion_requests
  SET 
    status = 'cancelled',
    cancelled_at = NOW()
  WHERE id = v_request_id;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ACCOUNT_DELETION_CANCELLED',
    jsonb_build_object(
      'area', 'account',
      'severity', 'info',
      'request_id', v_request_id
    )
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'request_id', v_request_id,
    'message', 'Account deletion cancelled'
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION cancel_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_account_deletion() TO authenticated;

COMMENT ON FUNCTION cancel_account_deletion() IS 
'Cancels a pending account deletion request within the 30-day grace period.';
