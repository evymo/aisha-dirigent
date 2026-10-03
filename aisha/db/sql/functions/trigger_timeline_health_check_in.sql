CREATE OR REPLACE FUNCTION public.trigger_timeline_health_check_in()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_content TEXT;
  v_result JSONB;
  v_check_in_count INT;
BEGIN
  -- Only on INSERT (new check-in)
  IF TG_OP = 'INSERT' THEN
    
    -- Get user's check-in count for streak tracking
    SELECT COUNT(*) INTO v_check_in_count
    FROM health_check_ins
    WHERE user_id = NEW.user_id;
    
    -- Build content (no sensitive data values!)
    v_content := 'timeline.health_check_in';
    
    -- Add timeline entry
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_check_in',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'check_in_id', NEW.id,
        'check_in_number', v_check_in_count,
        'check_in_date', NEW.check_in_date
      ),
      p_occurred_at := NEW.check_in_date,
      p_source_table := 'health_check_ins',
      p_source_id := NEW.id
    );
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_health_check_in() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_health_check_in() TO authenticated;
