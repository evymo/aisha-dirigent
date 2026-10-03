-- Trigger: set_updated_at_agent_knowledge_bindings
-- Table: agent_knowledge_bindings

CREATE TRIGGER set_updated_at_agent_knowledge_bindings
    BEFORE UPDATE ON public.agent_knowledge_bindings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
