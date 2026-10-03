-- Trigger: trg_signal_tag_rules_updated_at
-- Table: signal_tag_rules

CREATE TRIGGER trg_signal_tag_rules_updated_at
  BEFORE UPDATE ON public.signal_tag_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
