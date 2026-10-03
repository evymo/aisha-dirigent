-- Trigger: sync_health_metrics_trigger

CREATE TRIGGER sync_health_metrics_trigger
  AFTER INSERT ON public.health_check_ins
  FOR EACH ROW
  EXECUTE FUNCTION sync_checkin_to_metrics();
