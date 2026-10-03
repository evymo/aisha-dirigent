-- Trigger: set_updated_at_rule_bindings

CREATE TRIGGER set_updated_at_rule_bindings
  BEFORE UPDATE ON public.rule_bindings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
