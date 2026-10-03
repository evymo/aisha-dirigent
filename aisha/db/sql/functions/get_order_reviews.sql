-- Function: public.get_order_reviews
-- Arguments: p_order_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:08+01:00

CREATE OR REPLACE FUNCTION public.get_order_reviews(p_order_id uuid)
 RETURNS TABLE(id uuid, order_id uuid, user_id uuid, rating integer, title text, review text, is_verified_purchase boolean, is_featured boolean, created_at timestamptz, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    r.id, r.order_id, r.user_id, r.rating, r.title, r.review,
    r.is_verified_purchase, r.is_featured, r.created_at, r.updated_at
  FROM order_reviews r
  WHERE r.order_id = p_order_id
  ORDER BY r.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_order_reviews(p_order_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_order_reviews(p_order_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_order_reviews(p_order_id uuid) TO authenticated;
