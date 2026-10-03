-- Function: trigger_timeline_health_log
-- Purpose: Auto-creates timeline entry when member logs a health state (symptom)
-- Access: Trigger-only (AFTER INSERT on member_health_logs)
-- Security: SECURITY DEFINER, no sensitive data in metadata (no severity values, no notes)

CREATE OR REPLACE FUNCTION public.trigger_timeline_health_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_state_name TEXT;
  v_state_icon TEXT;
  v_result JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN

    -- Get health state name/icon if linked
    IF NEW.state_id IS NOT NULL THEN
      SELECT
        COALESCE(mhs.custom_name, mhs.name_key, '') ,
        COALESCE(mhs.icon, '🩺')
      INTO v_state_name, v_state_icon
      FROM member_health_states mhs
      WHERE mhs.id = NEW.state_id;
    END IF;

    -- Add timeline entry (NO sensitive data: no severity value, no notes!)
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_check_in',
      p_content := 'timeline.health_state_logged',
      p_metadata := jsonb_build_object(
        'health_log_id', NEW.id,
        'state_name', COALESCE(v_state_name, ''),
        'state_icon', COALESCE(v_state_icon, '🩺'),
        'logged_at', NEW.logged_at
      ),
      p_occurred_at := COALESCE(NEW.logged_at, NEW.created_at),
      p_source_table := 'member_health_logs',
      p_source_id := NEW.id
    );

  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on member_health_logs
DROP TRIGGER IF EXISTS trg_timeline_health_log ON member_health_logs;
CREATE TRIGGER trg_timeline_health_log
  AFTER INSERT ON member_health_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_timeline_health_log();

COMMENT ON FUNCTION public.trigger_timeline_health_log() IS
  'Auto-creates StoryLoop timeline entry when member logs a health state (symptom). No sensitive data in metadata.';

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_health_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_health_log() TO authenticated;
