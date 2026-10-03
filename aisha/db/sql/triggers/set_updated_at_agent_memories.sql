-- Trigger: set_updated_at_agent_memories

CREATE TRIGGER set_updated_at_agent_memories
  BEFORE UPDATE ON public.agent_memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
