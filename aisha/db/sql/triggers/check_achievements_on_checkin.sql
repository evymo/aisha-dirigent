-- Trigger: check_achievements_on_checkin
-- Table: health_check_ins
-- Purpose: Auto-check achievements when user submits health check-in

CREATE OR REPLACE TRIGGER check_achievements_on_checkin
  AFTER INSERT ON public.health_check_ins
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_achievements();

COMMENT ON TRIGGER check_achievements_on_checkin ON health_check_ins IS 'Auto-check achievements when user submits health check-in';
