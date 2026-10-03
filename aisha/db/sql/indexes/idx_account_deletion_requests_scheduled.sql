-- Index: idx_account_deletion_requests_scheduled
-- Table: account_deletion_requests

CREATE INDEX idx_account_deletion_requests_scheduled 
  ON account_deletion_requests(scheduled_deletion_at) 
  WHERE status = 'pending';
