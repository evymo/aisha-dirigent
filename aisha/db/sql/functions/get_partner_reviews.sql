-- Function: public.get_partner_reviews
-- Arguments: p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:15+01:00

CREATE OR REPLACE FUNCTION public.get_partner_reviews(p_partner_id uuid)
 RETURNS TABLE(id uuid, partner_id uuid, user_id uuid, rating integer, title text, review text, is_verified_client boolean, is_featured boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    r.id, r.partner_id, r.user_id, r.rating, r.title, r.review,
    r.is_verified_client, r.is_featured, r.created_at, r.updated_at
  FROM partner_reviews r
  WHERE r.partner_id = p_partner_id
  ORDER BY r.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_reviews(p_partner_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_reviews(p_partner_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_reviews(p_partner_id uuid) TO authenticated;
