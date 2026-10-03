-- Trigger: update_account_deletion_requests_updated_at
-- Table: account_deletion_requests

CREATE TRIGGER update_account_deletion_requests_updated_at
    BEFORE UPDATE ON public.account_deletion_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
