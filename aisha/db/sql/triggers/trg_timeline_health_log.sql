-- Trigger: trg_timeline_health_log

CREATE TRIGGER trg_timeline_health_log
  AFTER INSERT ON public.member_health_logs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_health_log();
