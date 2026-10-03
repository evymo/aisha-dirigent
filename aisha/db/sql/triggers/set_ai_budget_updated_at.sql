-- Trigger: set_ai_budget_updated_at
-- Pairs with ai_budget.updated_at column. The audited RPCs (set_ai_budget_audited,
-- fn_check_and_consume_ai_budget_audited) write updated_at explicitly, but any
-- direct UPDATE (admin SQL session, etc.) gets the same auto-bump.

CREATE TRIGGER set_ai_budget_updated_at
  BEFORE UPDATE ON public.ai_budget
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
