-- Function: trigger_timeline_wearable_analysis_file
-- Purpose: Add system timeline entry when wearable analysis file reference is created
-- Access: Trigger-only (AFTER INSERT on wearable_analysis_files)
-- Security: SECURITY DEFINER, only reference metadata (no sensitive data payload)

CREATE OR REPLACE FUNCTION public.trigger_timeline_wearable_analysis_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_health_sync',
      p_content := 'timeline.health_sync_analysis_ready',
      p_metadata := jsonb_build_object(
        'sync_batch_id', NEW.sync_batch_id,
        'data_source', NEW.data_source,
        'analysis_kind', NEW.analysis_kind,
        'analysis_file_id', NEW.id,
        'analysis_file_bucket', NEW.file_bucket,
        'analysis_file_path', NEW.file_path,
        'analysis_file_name', NEW.file_name
      ),
      p_occurred_at := NEW.created_at,
      p_source_table := 'wearable_analysis_files',
      p_source_id := NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_timeline_wearable_analysis_file() IS
  'Auto-creates timeline entry for wearable analysis file references.';

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_wearable_analysis_file() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_wearable_analysis_file() TO authenticated;
