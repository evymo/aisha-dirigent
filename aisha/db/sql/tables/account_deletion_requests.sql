-- Account Deletion Requests Table
-- Tracks user requests for account deletion with 30-day grace period

CREATE TABLE account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  reason TEXT,
  feedback TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status account_deletion_status NOT NULL DEFAULT 'pending',
  processed_by UUID REFERENCES aisha_auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Comment
COMMENT ON TABLE account_deletion_requests IS 
'Tracks user requests for account deletion. Requests have a 30-day grace period before processing.';
