-- Function: public.create_distribution_adjustment
-- Arguments: p_member_token text, p_adjustment_type text, p_reason text, p_effective_from date DEFAULT CURRENT_DATE, p_effective_until date DEFAULT NULL::date, p_new_dose_amount numeric DEFAULT NULL::numeric, p_new_doses_per_day integer DEFAULT NULL::integer, p_new_dose_timing text[] DEFAULT NULL::text[], p_new_arm_code text DEFAULT NULL::text, p_protocol_id uuid DEFAULT NULL::uuid, p_consultant_note text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_distribution_adjustment(p_member_token text, p_adjustment_type text, p_reason text, p_effective_from date DEFAULT CURRENT_DATE, p_effective_until date DEFAULT NULL::date, p_new_dose_amount numeric DEFAULT NULL::numeric, p_new_doses_per_day integer DEFAULT NULL::integer, p_new_dose_timing text[] DEFAULT NULL::text[], p_new_arm_code text DEFAULT NULL::text, p_protocol_id uuid DEFAULT NULL::uuid, p_consultant_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_adjustment_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) AND NOT has_role(v_user_id, 'consultant') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO distribution_adjustments (
    member_token, protocol_id, adjustment_type, new_dose_amount, new_doses_per_day,
    new_dose_timing, new_arm_code, effective_from, effective_until, reason,
    authorized_by, consultant_note
  ) VALUES (
    p_member_token, p_protocol_id, p_adjustment_type, p_new_dose_amount, p_new_doses_per_day,
    p_new_dose_timing, p_new_arm_code, p_effective_from, p_effective_until, p_reason,
    v_user_id, p_consultant_note
  )
  RETURNING id INTO v_adjustment_id;

  INSERT INTO audit_journal (user_id, action_type, area, entity_type, entity_id, summary, severity)
  VALUES (v_user_id, 'create', 'admin', 'distribution_adjustment', v_adjustment_id::text, 'Created distribution adjustment for member', 'info');

  RETURN v_adjustment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_distribution_adjustment(text, text, text, date, date, numeric, integer, text[][], text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_distribution_adjustment(text, text, text, date, date, numeric, integer, text[][], text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_distribution_adjustment(text, text, text, date, date, numeric, integer, text[][], text, uuid, text) TO service_role;
