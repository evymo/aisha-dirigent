-- Trigger: trg_timeline_health_sync

CREATE TRIGGER trg_timeline_health_sync
  AFTER INSERT ON public.health_data_sync_log
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_health_sync();
