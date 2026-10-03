-- Trigger: update_member_health_states_updated_at
-- Table: member_health_states

CREATE TRIGGER update_member_health_states_updated_at
    BEFORE UPDATE ON public.member_health_states
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
