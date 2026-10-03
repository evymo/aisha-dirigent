-- Trigger: set_updated_at_agent_catalog

CREATE TRIGGER set_updated_at_agent_catalog
  BEFORE UPDATE ON public.agent_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
