-- Function: public.get_appointment_member_info
-- Arguments: p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:35+01:00

CREATE OR REPLACE FUNCTION public.get_appointment_member_info(p_partner_id uuid)
 RETURNS TABLE(user_id uuid, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Verify the caller is the partner or admin/staff
  IF NOT (
    EXISTS (
      SELECT 1 FROM partner_profiles pp
      WHERE pp.id = p_partner_id AND pp.user_id = auth.uid()
    ) OR is_admin_or_staff(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Access denied: not authorized to view this data';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    p.user_id,
    p.display_name
  FROM partner_appointments pa
  JOIN profiles p ON p.user_id = pa.member_id
  WHERE pa.partner_id = p_partner_id
  ORDER BY p.display_name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_appointment_member_info(p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_appointment_member_info(p_partner_id uuid) TO authenticated;
