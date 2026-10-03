-- Function: trigger_timeline_dosing_log
-- Purpose: Auto-creates timeline entry when member logs a dose
-- Access: Trigger-only (AFTER INSERT on dosing_logs)
-- Security: SECURITY DEFINER, no sensitive data in metadata (no dose values, no notes, no side effects)

CREATE OR REPLACE FUNCTION public.trigger_timeline_dosing_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_study_title TEXT;
  v_product_name TEXT;
  v_content TEXT;
  v_result JSONB;
BEGIN
  -- Only on INSERT (new dosing log)
  IF TG_OP = 'INSERT' THEN

    -- Get study title if linked
    IF NEW.study_id IS NOT NULL THEN
      SELECT title INTO v_study_title
      FROM studies
      WHERE id = NEW.study_id;
    END IF;

    -- Get product name if linked
    IF NEW.product_id IS NOT NULL THEN
      SELECT name INTO v_product_name
      FROM products
      WHERE id = NEW.product_id;
    END IF;

    -- i18n content key
    v_content := 'timeline.dosing_logged';

    -- Add timeline entry (NO sensitive data: no dose_ml, notes, side_effects!)
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_dosing',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'dosing_log_id', NEW.id,
        'dose_date', NEW.dose_date,
        'product_name', COALESCE(v_product_name, ''),
        'report_type', COALESCE(NEW.report_type, 'single'),
        'study_id', NEW.study_id,
        'study_title', COALESCE(v_study_title, '')
      ),
      p_occurred_at := COALESCE(NEW.logged_at, NEW.dosed_at, NEW.created_at),
      p_source_table := 'dosing_logs',
      p_source_id := NEW.id
    );

  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on dosing_logs
DROP TRIGGER IF EXISTS trg_timeline_dosing_log ON dosing_logs;
CREATE TRIGGER trg_timeline_dosing_log
  AFTER INSERT ON dosing_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_timeline_dosing_log();

COMMENT ON FUNCTION public.trigger_timeline_dosing_log() IS
  'Auto-creates StoryLoop timeline entry when member logs a dose. No sensitive data in metadata (no distribution values, notes, side_effects).';

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_dosing_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_dosing_log() TO authenticated;
