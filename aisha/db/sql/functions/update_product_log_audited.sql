-- Function: public.update_product_log_audited
-- Arguments: p_log_id uuid, p_dose_taken numeric DEFAULT NULL::numeric, p_taken_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.update_product_log_audited(p_log_id uuid, p_dose_taken numeric DEFAULT NULL::numeric, p_taken_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log record;
  v_old_dose numeric;
  v_new_dose numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get and verify ownership
  SELECT * INTO v_log 
  FROM member_product_logs 
  WHERE id = p_log_id AND user_id = auth.uid();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Log not found or not owned';
  END IF;

  v_old_dose := v_log.dose_taken;
  v_new_dose := COALESCE(p_dose_taken, v_log.dose_taken);

  -- Update the log
  UPDATE member_product_logs
  SET 
    dose_taken = COALESCE(p_dose_taken, dose_taken),
    logged_at = COALESCE(p_taken_at, logged_at),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_log_id;

  -- Adjust remaining doses if dose changed
  IF p_dose_taken IS NOT NULL AND v_old_dose != v_new_dose THEN
    UPDATE member_product_plans
    SET remaining_doses = remaining_doses + v_old_dose - v_new_dose
    WHERE id = v_log.plan_id;
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'update', 'member_product_log', p_log_id::text, 'member', 'info', 
          format('Updated product log: dose %s -> %s', v_old_dose, v_new_dose));

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_product_log_audited(uuid, numeric, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_product_log_audited(uuid, numeric, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_log_audited(uuid, numeric, timestamptz, text) TO service_role;
