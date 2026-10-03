-- Function: public.get_partner_appointments
-- Arguments: p_partner_id uuid, p_date date, p_include_member_info boolean
-- Description: Get partner appointments - only for partner owner.
-- @security: authenticated
-- @audit: required
-- @phi: true
-- Extracted: 2026-01-08T18:27:10+01:00

CREATE OR REPLACE FUNCTION public.get_partner_appointments(p_partner_id uuid, p_date date DEFAULT NULL::date, p_include_member_info boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_user_id uuid := auth.uid();
BEGIN
  -- Auth check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorization: must be owner of partner profile
  IF NOT EXISTS (SELECT 1 FROM partner_profiles WHERE id = p_partner_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Access denied: not owner of partner profile';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := jsonb_build_object('partner_id', p_partner_id, 'date', p_date),
      p_entity_id := NULL,
      p_entity_type := 'partner_appointments',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewing appointments',
      p_tags := ARRAY['phi','partner','appointments'],
      p_user_id := v_user_id
  );

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', pa.id,
      'partner_id', pa.partner_id,
      'member_id', pa.member_id,
      'appointment_date', pa.appointment_date,
      'start_time', pa.start_time,
      'end_time', pa.end_time,
      'appointment_type', pa.appointment_type,
      'status', pa.status,
      'service', pa.service,
      'created_at', pa.created_at,
      'updated_at', pa.updated_at,
      'member', CASE WHEN p_include_member_info THEN
        (SELECT jsonb_build_object('user_id', pr.user_id, 'display_name', pr.display_name)
         FROM profiles pr WHERE pr.user_id = pa.member_id)
      ELSE NULL END
    )
    ORDER BY pa.appointment_date, pa.start_time
  )
  INTO v_result
  FROM partner_appointments pa
  WHERE pa.partner_id = p_partner_id
    AND pa.status != 'cancelled'
    AND (p_date IS NULL OR pa.appointment_date = p_date);

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_appointments(p_partner_id uuid, p_date date, p_include_member_info boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_appointments(p_partner_id uuid, p_date date, p_include_member_info boolean) TO authenticated;
