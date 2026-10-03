-- Trigger: set_agent_tools_updated_at

CREATE TRIGGER set_agent_tools_updated_at
  BEFORE UPDATE ON public.agent_tools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
