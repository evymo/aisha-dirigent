-- Index: idx_account_deletion_requests_user_id
-- Table: account_deletion_requests

CREATE INDEX idx_account_deletion_requests_user_id 
  ON account_deletion_requests(user_id);
