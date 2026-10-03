-- Function: trigger_timeline_product_log
-- Purpose: Auto-creates timeline entry when member logs a product intake
-- Access: Trigger-only (AFTER INSERT on member_product_logs)
-- Security: SECURITY DEFINER, no sensitive data in metadata (no dose values, no notes)

CREATE OR REPLACE FUNCTION public.trigger_timeline_product_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan_name TEXT;
  v_product_name TEXT;
  v_result JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN

    -- Get plan name if linked
    IF NEW.plan_id IS NOT NULL THEN
      SELECT msp.name INTO v_plan_name
      FROM member_product_plans msp
      WHERE msp.id = NEW.plan_id;
    END IF;

    -- Get product name if linked
    IF NEW.product_id IS NOT NULL THEN
      SELECT p.name INTO v_product_name
      FROM products p
      WHERE p.id = NEW.product_id;
    END IF;

    -- Add timeline entry (NO sensitive data: no dose_taken, notes!)
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_dosing',
      p_content := 'timeline.product_logged',
      p_metadata := jsonb_build_object(
        'product_log_id', NEW.id,
        'plan_name', COALESCE(v_plan_name, ''),
        'product_name', COALESCE(v_product_name, ''),
        'logged_at', NEW.logged_at
      ),
      p_occurred_at := COALESCE(NEW.logged_at, NEW.created_at),
      p_source_table := 'member_product_logs',
      p_source_id := NEW.id
    );

  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on member_product_logs
DROP TRIGGER IF EXISTS trg_timeline_product_log ON member_product_logs;
CREATE TRIGGER trg_timeline_product_log
  AFTER INSERT ON member_product_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_timeline_product_log();

COMMENT ON FUNCTION public.trigger_timeline_product_log() IS
  'Auto-creates StoryLoop timeline entry when member logs a product intake. No sensitive data in metadata.';

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_product_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_product_log() TO authenticated;
