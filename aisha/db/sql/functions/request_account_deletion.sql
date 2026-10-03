-- Request account deletion
-- This creates an account deletion request that will be processed within 30 days
-- User data is anonymized, not immediately deleted, for compliance

CREATE OR REPLACE FUNCTION request_account_deletion(
  p_reason TEXT DEFAULT NULL,
  p_feedback TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_request_id UUID;
  v_deletion_date TIMESTAMPTZ;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get user email for confirmation
  SELECT email INTO v_user_email
  FROM aisha_auth.users
  WHERE id = v_user_id;
  
  -- Calculate deletion date (30 days from now for compliance)
  v_deletion_date := NOW() + INTERVAL '30 days';
  
  -- Check if there's already a pending deletion request
  IF EXISTS (
    SELECT 1 FROM account_deletion_requests
    WHERE user_id = v_user_id
    AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Deletion request already pending';
  END IF;
  
  -- Create deletion request
  INSERT INTO account_deletion_requests (
    user_id,
    reason,
    feedback,
    requested_at,
    scheduled_deletion_at,
    status
  )
  VALUES (
    v_user_id,
    p_reason,
    p_feedback,
    NOW(),
    v_deletion_date,
    'pending'
  )
  RETURNING id INTO v_request_id;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ACCOUNT_DELETION_REQUESTED',
    jsonb_build_object(
      'area', 'account',
      'severity', 'warning',
      'request_id', v_request_id,
      'scheduled_deletion_at', v_deletion_date
    )
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'request_id', v_request_id,
    'scheduled_deletion_at', v_deletion_date,
    'message', 'Account deletion scheduled'
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION request_account_deletion(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_account_deletion(text, text) TO authenticated;

COMMENT ON FUNCTION request_account_deletion(text, text) IS 
'Creates an account deletion request. Account will be deleted after 30 days for compliance.';
