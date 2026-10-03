-- Trigger: set_updated_at_blockchain_audit_records
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER set_updated_at_blockchain_audit_records BEFORE UPDATE ON public.blockchain_audit_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
