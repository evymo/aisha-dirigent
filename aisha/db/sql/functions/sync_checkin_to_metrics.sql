-- Function: public.sync_checkin_to_metrics
-- Description: Trigger function to sync health_check_ins to health_metrics
-- Security: SECURITY DEFINER (trigger function)
-- sensitive data: Yes - copies health data between tables

CREATE OR REPLACE FUNCTION public.sync_checkin_to_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  -- Only sync if we have relevant metrics
  IF NEW.energy_level IS NOT NULL 
     OR NEW.mood_level IS NOT NULL 
     OR NEW.pain_level IS NOT NULL 
     OR NEW.sleep_quality IS NOT NULL THEN
    
    INSERT INTO health_metrics (
      user_id,
      study_registration_id,
      measured_at,
      energy_level,
      mental_state,  -- mood_level maps to mental_state
      pain_level,
      sleep_quality,
      source,
      source_id
    ) VALUES (
      NEW.user_id,
      NEW.study_registration_id,
      COALESCE(NEW.check_in_date::TIMESTAMPTZ, NEW.created_at),
      NEW.energy_level,
      NEW.mood_level,
      NEW.pain_level,
      NEW.sleep_quality,
      'check_in',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger (idempotent)
DROP TRIGGER IF EXISTS sync_health_metrics_trigger ON health_check_ins;

CREATE TRIGGER sync_health_metrics_trigger
AFTER INSERT ON health_check_ins
FOR EACH ROW
EXECUTE FUNCTION sync_checkin_to_metrics();

-- Permissions - trigger function, not called directly via RPC
REVOKE ALL ON FUNCTION public.sync_checkin_to_metrics() FROM PUBLIC;

COMMENT ON FUNCTION public.sync_checkin_to_metrics() IS 'Automatically sync health check-in data to health_metrics table';
