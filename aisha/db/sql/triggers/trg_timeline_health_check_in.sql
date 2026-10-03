-- Trigger: trg_timeline_health_check_in

CREATE TRIGGER trg_timeline_health_check_in
  AFTER INSERT ON public.health_check_ins
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_health_check_in();
