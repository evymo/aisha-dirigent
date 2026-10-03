-- Index: idx_account_deletion_requests_status
-- Table: account_deletion_requests

CREATE INDEX idx_account_deletion_requests_status 
  ON account_deletion_requests(status);
