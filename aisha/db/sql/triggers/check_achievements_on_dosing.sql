-- Trigger: check_achievements_on_dosing
-- Table: dosing_logs
-- Purpose: Auto-check achievements when user logs product dose

CREATE OR REPLACE TRIGGER check_achievements_on_dosing
  AFTER INSERT ON public.dosing_logs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_achievements();

COMMENT ON TRIGGER check_achievements_on_dosing ON dosing_logs IS 'Auto-check achievements when user logs product dose';
