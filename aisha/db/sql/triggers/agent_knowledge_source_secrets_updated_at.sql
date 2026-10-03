-- Trigger: agent_knowledge_source_secrets_updated_at
-- Source of truth pair: aisha/db/sql/tables/agent_knowledge_source_secrets.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS agent_knowledge_source_secrets_updated_at ON public.agent_knowledge_source_secrets;
CREATE TRIGGER agent_knowledge_source_secrets_updated_at
  BEFORE UPDATE ON public.agent_knowledge_source_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
