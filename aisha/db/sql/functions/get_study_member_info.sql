-- Function: get_study_member_info
-- Returns member info for consultant users
-- Frontend: src/hooks/useConsultantUsers.ts

CREATE OR REPLACE FUNCTION public.get_study_member_info(
  p_partner_id uuid DEFAULT NULL,
  p_study_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  display_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  -- Verify caller is admin/staff or the partner themselves
  IF NOT public.is_admin_or_staff(v_caller_id) AND v_caller_id != (
    SELECT pp.user_id FROM partner_profiles pp WHERE pp.id = p_partner_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := jsonb_build_object('partner_id', p_partner_id, 'study_id', p_study_id),
      p_entity_id := NULL,
      p_entity_type := 'data_sharing_consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Viewing study member info for consented users',
      p_tags := ARRAY['phi','partner','study'],
      p_user_id := v_caller_id
  );

  RETURN QUERY
  SELECT DISTINCT
    p.user_id,
    p.display_name
  FROM profiles p
  JOIN data_sharing_consents dsc ON dsc.user_id = p.user_id
  WHERE dsc.partner_id = p_partner_id
    AND dsc.revoked_at IS NULL
    AND (p_study_id IS NULL OR EXISTS (
      SELECT 1 FROM study_registrations se
      WHERE se.user_id = p.user_id AND se.study_id = p_study_id
    ))
  ORDER BY p.display_name;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_member_info(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_member_info(uuid, uuid) TO authenticated;
