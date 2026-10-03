-- Function: trigger_timeline_health_sync
-- Purpose: Auto-creates timeline entry when health data sync completes
-- Access: Trigger-only (AFTER INSERT on health_data_sync_log)
-- Security: SECURITY DEFINER, no sensitive data in metadata

CREATE OR REPLACE FUNCTION public.trigger_timeline_health_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_data_source TEXT;
  v_icon TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN

    -- Only create timeline entry for successful syncs (inserted_count > 0)
    IF NEW.inserted_count = 0 AND NEW.error_count = 0 THEN
      RETURN NEW;
    END IF;

    -- Determine icon based on data source
    v_data_source := COALESCE(NEW.data_source, 'manual');
    CASE
      WHEN v_data_source LIKE '%healthkit%' THEN v_icon := '🍎';
      WHEN v_data_source LIKE '%health_connect%' THEN v_icon := '🤖';
      WHEN v_data_source LIKE '%wearable%' THEN v_icon := '⌚';
      ELSE v_icon := '📊';
    END CASE;

    -- Add timeline entry (NO sensitive data: no health values, no device identifiers!)
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_health_sync',
      p_content := 'timeline.health_sync_completed',
      p_metadata := jsonb_build_object(
        'sync_batch_id', NEW.sync_batch_id,
        'data_source', v_data_source,
        'records_count', NEW.records_count,
        'inserted_count', NEW.inserted_count,
        'icon', v_icon
      ),
      p_occurred_at := COALESCE(NEW.sync_completed_at, NEW.created_at),
      p_source_table := 'health_data_sync_log',
      p_source_id := NEW.id
    );

  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_timeline_health_sync() IS
  'Auto-creates StoryLoop timeline entry when health data sync completes. No sensitive data in metadata.';

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_health_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_health_sync() TO authenticated;

-- Trigger: see supabase/sql/triggers/trigger_timeline_health_sync.sql
