-- Trigger: update_token_reward_rules_updated_at
-- Table: token_reward_rules

CREATE TRIGGER update_token_reward_rules_updated_at
    BEFORE UPDATE ON public.token_reward_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
