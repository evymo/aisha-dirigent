-- Trigger: update_streak_on_health_checkin
-- Table: health_check_ins

CREATE TRIGGER update_streak_on_health_checkin
AFTER INSERT
ON public.health_check_ins
FOR EACH ROW
EXECUTE FUNCTION trigger_update_streak_on_health_checkin();
