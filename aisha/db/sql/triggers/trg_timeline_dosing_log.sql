-- Trigger: trg_timeline_dosing_log

CREATE TRIGGER trg_timeline_dosing_log
  AFTER INSERT ON public.dosing_logs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_dosing_log();
