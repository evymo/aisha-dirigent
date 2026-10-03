-- Function: public.create_member_distribution_plan_on_registration
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:05+01:00

CREATE OR REPLACE FUNCTION public.create_member_distribution_plan_on_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_protocol RECORD;
  v_subscription_id UUID;
BEGIN
  -- Only trigger for 'enrolled' or 'active' status
  IF NEW.status NOT IN ('enrolled', 'active') THEN
    RETURN NEW;
  END IF;
  
  -- Check if plan already exists
  IF EXISTS (SELECT 1 FROM member_distribution_plans WHERE user_id = NEW.user_id AND study_registration_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  
  -- Get active subscription
  SELECT id INTO v_subscription_id
  FROM member_subscriptions
  WHERE user_id = NEW.user_id AND status = 'active'
  ORDER BY period_end DESC
  LIMIT 1;
  
  -- Create plan for each protocol in the study
  FOR v_protocol IN
    SELECT id, duration_days FROM study_distribution_protocols
    WHERE study_id = NEW.study_id AND is_active = true
  LOOP
    INSERT INTO member_distribution_plans (
      user_id,
      study_registration_id,
      subscription_id,
      protocol_id,
      starts_at,
      ends_at
    ) VALUES (
      NEW.user_id,
      NEW.id,
      v_subscription_id,
      v_protocol.id,
      CURRENT_DATE,
      CASE 
        WHEN v_protocol.duration_days IS NOT NULL 
        THEN CURRENT_DATE + v_protocol.duration_days
        ELSE NULL
      END
    );
  END LOOP;
  
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_member_distribution_plan_on_registration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_member_distribution_plan_on_registration() TO authenticated;
