CREATE OR REPLACE FUNCTION public.trigger_timeline_study_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_study_title TEXT;
  v_content TEXT;
  v_result JSONB;
BEGIN
  -- Only on status changes
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    
    -- Get study title
    SELECT title INTO v_study_title
    FROM studies
    WHERE id = NEW.study_id;
    
    -- Build content based on status
    CASE NEW.status
      WHEN 'active' THEN
        v_content := 'timeline.study_enrolled';
      WHEN 'completed' THEN
        v_content := 'timeline.study_completed';
      WHEN 'withdrawn' THEN
        v_content := 'timeline.study_withdrawn';
      ELSE
        -- Skip other statuses
        RETURN NEW;
    END CASE;
    
    -- Add timeline entry
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_registration',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'study_id', NEW.study_id,
        'study_title', v_study_title,
        'registration_status', NEW.status
      ),
      p_occurred_at := now(),
      p_source_table := 'study_registrations',
      p_source_id := NEW.id
    );
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_study_registration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_study_registration() TO authenticated;
