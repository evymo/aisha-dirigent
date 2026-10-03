-- Trigger: set_updated_at_reward_claims
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER set_updated_at_reward_claims BEFORE UPDATE ON public.reward_claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
