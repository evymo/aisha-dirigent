-- Function: public.sync_reminder_completions
-- Arguments: p_completions jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:10+01:00

CREATE OR REPLACE FUNCTION public.sync_reminder_completions(p_completions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_completion JSONB;
  v_total_points INTEGER := 0;
  v_synced_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_new_balance NUMERIC;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- RATE LIMITING: 20 requests per minute
  PERFORM enforce_rate_limit('sync_reminder_completions', 60000, 20);

  -- Validate input
  IF jsonb_typeof(p_completions) != 'array' THEN
    RAISE EXCEPTION 'p_completions must be an array';
  END IF;

  IF jsonb_array_length(p_completions) > 50 THEN
    RAISE EXCEPTION 'Maximum 50 completions per sync';
  END IF;

  -- Process each completion
  FOR v_completion IN SELECT * FROM jsonb_array_elements(p_completions)
  LOOP
    BEGIN
      DECLARE
        v_result JSONB;
      BEGIN
        -- Call complete_reminder for each (rate limit is bypassed internally)
        SELECT complete_reminder(
          (v_completion->>'reminder_id')::UUID,
          v_completion->'quick_response',
          NULL,
          NULL
        ) INTO v_result;

        v_total_points := v_total_points + (v_result->>'points_awarded')::INTEGER;
        v_synced_count := v_synced_count + 1;
      END;
    EXCEPTION
      WHEN OTHERS THEN
        -- Skip if already completed or other error
        v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  -- Get new balance
  SELECT balance INTO v_new_balance
  FROM token_allocations
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'synced_count', v_synced_count,
    'skipped_count', v_skipped_count,
    'points_awarded', v_total_points,
    'new_balance', v_new_balance
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.sync_reminder_completions(p_completions jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_reminder_completions(p_completions jsonb) TO authenticated;
