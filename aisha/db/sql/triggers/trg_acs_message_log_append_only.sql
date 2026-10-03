-- Trigger: trg_acs_message_log_append_only
-- Table: acs_message_log

DROP TRIGGER IF EXISTS trg_acs_message_log_append_only ON public.acs_message_log;
CREATE TRIGGER trg_acs_message_log_append_only
  BEFORE UPDATE OR DELETE ON public.acs_message_log
  FOR EACH ROW EXECUTE FUNCTION acs_message_log_block_mutation();
