-- Trigger: trg_expert_rules_change_notification

CREATE TRIGGER trg_expert_rules_change_notification
  AFTER DELETE ON public.expert_rules
  FOR EACH ROW
  EXECUTE FUNCTION notify_expert_rules_changed();
