CREATE OR REPLACE FUNCTION public.trigger_timeline_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_content TEXT;
  v_result JSONB;
BEGIN
  -- Only on INSERT (new order) or status change to 'delivered'
  IF TG_OP = 'INSERT' THEN
    
    v_content := 'timeline.order_created';
    
    -- Add timeline entry (no financial data in metadata!)
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_order',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'order_id', NEW.id,
        'status', NEW.status
      ),
      p_occurred_at := NEW.created_at,
      p_source_table := 'orders',
      p_source_id := NEW.id
    );
    
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'delivered' THEN
    
    v_content := 'timeline.order_delivered';
    
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_order',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'order_id', NEW.id,
        'status', NEW.status,
        'event', 'delivered'
      ),
      p_occurred_at := now(),
      p_source_table := 'orders',
      p_source_id := NEW.id
    );
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_order() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_order() TO authenticated;
