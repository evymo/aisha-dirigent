-- Trigger: ai_spend_policies_updated_at
-- Source of truth pair: aisha/db/sql/tables/ai_spend_policies.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds —
-- inline-in-table placement breaks cold-start ordering (tables precede functions).

DROP TRIGGER IF EXISTS ai_spend_policies_updated_at ON public.ai_spend_policies;
CREATE TRIGGER ai_spend_policies_updated_at
  BEFORE UPDATE ON public.ai_spend_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
