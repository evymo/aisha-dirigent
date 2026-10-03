-- Trigger: check_achievements_on_sync
-- Table: health_data_sync_log

CREATE TRIGGER check_achievements_on_sync
AFTER INSERT
ON public.health_data_sync_log
FOR EACH ROW
EXECUTE FUNCTION trigger_check_achievements();
