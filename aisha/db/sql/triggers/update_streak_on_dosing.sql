-- Trigger: update_streak_on_dosing
-- Table: dosing_logs
-- Purpose: Update streak when user logs product dose

CREATE OR REPLACE TRIGGER update_streak_on_dosing
  AFTER INSERT ON public.dosing_logs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_streak_on_activity();

COMMENT ON TRIGGER update_streak_on_dosing ON dosing_logs IS 'Update streak when user logs product dose';
