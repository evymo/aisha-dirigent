CREATE OR REPLACE FUNCTION public.trigger_timeline_lab_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_content TEXT;
  v_result JSONB;
BEGIN
  -- Only on INSERT (new lab result)
  IF TG_OP = 'INSERT' THEN
    
    v_content := 'timeline.lab_result_uploaded';
    
    -- Add timeline entry
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_lab_result',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'lab_result_id', NEW.id,
        'test_date', NEW.test_date
      ),
      p_occurred_at := COALESCE(NEW.test_date, NEW.created_at),
      p_source_table := 'lab_results',
      p_source_id := NEW.id
    );
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_lab_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_lab_result() TO authenticated;
