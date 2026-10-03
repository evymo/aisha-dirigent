-- Function: public.create_partner_appointment_review
-- Arguments: p_appointment_id uuid, p_partner_id uuid, p_rating integer, p_comment text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:08+01:00

CREATE OR REPLACE FUNCTION public.create_partner_appointment_review(p_appointment_id uuid, p_partner_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, appointment_id uuid, partner_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_review_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM partner_appointments WHERE partner_appointments.id = p_appointment_id AND partner_appointments.member_id = auth.uid()) THEN
    RAISE EXCEPTION 'Appointment not found or access denied';
  END IF;

  INSERT INTO partner_appointment_reviews (appointment_id, member_id, partner_id, rating, review)
  VALUES (p_appointment_id, auth.uid(), p_partner_id, p_rating, p_comment)
  RETURNING partner_appointment_reviews.id INTO v_review_id;

  RETURN QUERY
  SELECT v_review_id, p_appointment_id, p_partner_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_partner_appointment_review(p_appointment_id uuid, p_partner_id uuid, p_rating integer, p_comment text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partner_appointment_review(p_appointment_id uuid, p_partner_id uuid, p_rating integer, p_comment text) TO authenticated;
