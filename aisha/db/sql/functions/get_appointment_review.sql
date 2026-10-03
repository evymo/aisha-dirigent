-- Function: public.get_appointment_review
-- Arguments: p_appointment_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:35+01:00

CREATE OR REPLACE FUNCTION public.get_appointment_review(p_appointment_id uuid)
 RETURNS TABLE(id uuid, appointment_id uuid, member_id uuid, partner_id uuid, rating integer, comment text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT 
    r.id,
    r.appointment_id,
    r.member_id,
    r.partner_id,
    r.rating,
    r.comment,
    r.created_at,
    r.updated_at
  FROM partner_appointment_reviews r
  JOIN partner_appointments pa ON pa.id = r.appointment_id
  WHERE r.appointment_id = p_appointment_id
    AND (pa.member_id = auth.uid() OR EXISTS (
      SELECT 1 FROM partner_profiles pp WHERE pp.id = r.partner_id AND pp.user_id = auth.uid()
    ));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_appointment_review(p_appointment_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_appointment_review(p_appointment_id uuid) TO authenticated;
