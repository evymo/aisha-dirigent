-- Trigger: trg_expert_rule_propagation

CREATE TRIGGER trg_expert_rule_propagation
  AFTER INSERT ON public.expert_rules
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_rule_change();
