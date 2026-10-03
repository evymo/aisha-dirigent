-- Trigger: trg_expert_rule_ragnarok_sync
-- Fires fn_notify_knowledge_change() on expert_rules changes
-- to keep Ragnarok search index in sync.
-- (Note: trg_expert_rule_propagation handles copilot-instructions,
--  this trigger handles Ragnarok index sync separately)

CREATE TRIGGER trg_expert_rule_ragnarok_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.expert_rules
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_knowledge_change();
