-- Function: public.update_partner_appointment_review
-- Arguments: p_review_id uuid, p_rating integer, p_comment text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:22+01:00

CREATE OR REPLACE FUNCTION public.update_partner_appointment_review(p_review_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, appointment_id uuid, partner_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE partner_appointment_reviews
  SET rating = p_rating, review = p_comment, updated_at = now()
  WHERE partner_appointment_reviews.id = p_review_id AND partner_appointment_reviews.member_id = auth.uid();

  RETURN QUERY
  SELECT 
    r.id,
    r.appointment_id,
    r.partner_id
  FROM partner_appointment_reviews r
  WHERE r.id = p_review_id AND r.member_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_partner_appointment_review(p_review_id uuid, p_rating integer, p_comment text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_partner_appointment_review(p_review_id uuid, p_rating integer, p_comment text) TO authenticated;
