-- Function: public.get_partner_appointment_reviews
-- Arguments: p_partner_id uuid
-- Description: Get reviews for a specific partner (public ratings)
-- Security: authenticated only, names anonymized for privacy
-- @security: authenticated
-- @audit: false (public ratings, not sensitive data)

CREATE OR REPLACE FUNCTION public.get_partner_appointment_reviews(p_partner_id uuid)
 RETURNS TABLE(id uuid, appointment_id uuid, member_id uuid, partner_id uuid, rating integer, comment text, created_at timestamptz, updated_at timestamptz, member_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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
    r.updated_at,
    -- Anonymize member names for privacy (show only initials)
    CASE 
      WHEN pr.first_name IS NOT NULL THEN 
        SUBSTRING(pr.first_name FROM 1 FOR 1) || '***'
      ELSE 'Anonymous'
    END::text as member_name
  FROM partner_appointment_reviews r
  LEFT JOIN profiles pr ON pr.id = r.member_id
  WHERE r.partner_id = p_partner_id
  ORDER BY r.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_appointment_reviews(p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_appointment_reviews(p_partner_id uuid) TO authenticated;
