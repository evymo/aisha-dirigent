-- Index: idx_account_deletion_requests_processed_by
-- Table: account_deletion_requests

CREATE INDEX idx_account_deletion_requests_processed_by 
  ON account_deletion_requests(processed_by)
  WHERE processed_by IS NOT NULL;
