-- Trigger: ai_risk_policies_updated_at
-- Source of truth pair: aisha/db/sql/tables/ai_risk_policies.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER functions
-- in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS ai_risk_policies_updated_at ON public.ai_risk_policies;
CREATE TRIGGER ai_risk_policies_updated_at
  BEFORE UPDATE ON public.ai_risk_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
