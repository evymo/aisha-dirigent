-- Trigger: trg_acs_message_log_notify
-- Table: acs_message_log

DROP TRIGGER IF EXISTS trg_acs_message_log_notify ON public.acs_message_log;
CREATE TRIGGER trg_acs_message_log_notify
  AFTER INSERT ON public.acs_message_log
  FOR EACH ROW EXECUTE FUNCTION acs_message_log_notify();
