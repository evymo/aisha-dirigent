-- Function: public.calculate_next_reminder_time
-- Arguments: p_reminder_id uuid
-- Description: Helper function to calculate next reminder time.
-- Security: Internal helper - called by trigger/other functions.
-- @internal: true

CREATE OR REPLACE FUNCTION public.calculate_next_reminder_time(p_reminder_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reminder RECORD;
  v_next_date DATE;
  v_current_dow INTEGER;
  v_target_dow INTEGER;
  v_days_until INTEGER;
  v_min_days INTEGER;
BEGIN
  -- Get reminder details
  SELECT * INTO v_reminder
  FROM user_reminders
  WHERE id = p_reminder_id;

  IF v_reminder IS NULL THEN
    RETURN NULL;
  END IF;

  v_current_dow := EXTRACT(DOW FROM CURRENT_DATE)::INTEGER; -- 0=Sunday, 1=Monday, etc.

  CASE v_reminder.frequency
    WHEN 'daily' THEN
      -- Next occurrence is today if time hasn't passed, else tomorrow
      IF CURRENT_TIME < v_reminder.time_of_day THEN
        v_next_date := CURRENT_DATE;
      ELSE
        v_next_date := CURRENT_DATE + 1;
      END IF;

    WHEN 'weekly' THEN
      -- Find next matching day of week
      v_min_days := 8; -- Start with more than a week
      IF v_reminder.custom_frequency_days IS NOT NULL THEN
        FOREACH v_target_dow IN ARRAY v_reminder.custom_frequency_days
        LOOP
          v_days_until := (v_target_dow - v_current_dow + 7) % 7;
          -- If today is a target day and time hasn't passed
          IF v_days_until = 0 AND CURRENT_TIME >= v_reminder.time_of_day THEN
            v_days_until := 7; -- Move to next week
          END IF;
          IF v_days_until < v_min_days THEN
            v_min_days := v_days_until;
          END IF;
        END LOOP;
        v_next_date := CURRENT_DATE + v_min_days;
      ELSE
        -- Default to next Monday if no days specified
        v_days_until := (1 - v_current_dow + 7) % 7;
        IF v_days_until = 0 AND CURRENT_TIME >= v_reminder.time_of_day THEN
          v_days_until := 7;
        END IF;
        v_next_date := CURRENT_DATE + v_days_until;
      END IF;

    WHEN 'biweekly' THEN
      -- Every 2 weeks from start_date
      IF v_reminder.start_date IS NOT NULL THEN
        v_days_until := 14 - ((CURRENT_DATE - v_reminder.start_date) % 14);
        IF v_days_until = 14 AND CURRENT_TIME >= v_reminder.time_of_day THEN
          v_days_until := 14;
        ELSIF v_days_until = 14 THEN
          v_days_until := 0;
        END IF;
      ELSE
        v_days_until := 14;
      END IF;
      v_next_date := CURRENT_DATE + v_days_until;

    WHEN 'monthly' THEN
      -- Same day each month
      v_next_date := date_trunc('month', CURRENT_DATE) + INTERVAL '1 month';
      IF CURRENT_DATE < date_trunc('month', CURRENT_DATE)::DATE + EXTRACT(DAY FROM COALESCE(v_reminder.start_date, CURRENT_DATE))::INTEGER - 1 THEN
        v_next_date := date_trunc('month', CURRENT_DATE)::DATE + EXTRACT(DAY FROM COALESCE(v_reminder.start_date, CURRENT_DATE))::INTEGER - 1;
      END IF;

    WHEN 'custom' THEN
      -- Same as weekly with custom days
      v_min_days := 8;
      IF v_reminder.custom_frequency_days IS NOT NULL THEN
        FOREACH v_target_dow IN ARRAY v_reminder.custom_frequency_days
        LOOP
          v_days_until := (v_target_dow - v_current_dow + 7) % 7;
          IF v_days_until = 0 AND CURRENT_TIME >= v_reminder.time_of_day THEN
            v_days_until := 7;
          END IF;
          IF v_days_until < v_min_days THEN
            v_min_days := v_days_until;
          END IF;
        END LOOP;
        v_next_date := CURRENT_DATE + v_min_days;
      ELSE
        v_next_date := CURRENT_DATE + 1;
      END IF;

    ELSE
      -- Default: tomorrow
      v_next_date := CURRENT_DATE + 1;
  END CASE;

  -- Combine date with time and apply timezone
  RETURN (v_next_date + v_reminder.time_of_day)::TIMESTAMP
    AT TIME ZONE COALESCE(v_reminder.user_timezone, 'Europe/Prague');
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.calculate_next_reminder_time(p_reminder_id uuid) FROM PUBLIC;
-- No GRANT - internal/helper function
