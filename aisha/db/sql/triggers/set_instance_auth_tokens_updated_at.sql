-- Trigger: set_instance_auth_tokens_updated_at
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER set_instance_auth_tokens_updated_at BEFORE UPDATE ON public.instance_auth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
