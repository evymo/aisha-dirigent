-- Function: public.update_order_review
-- Arguments: p_review_id uuid, p_rating integer, p_comment text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:21+01:00

CREATE OR REPLACE FUNCTION public.update_order_review(p_review_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_id uuid, user_id uuid, rating integer, review text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE order_reviews
  SET rating = p_rating, review = p_comment
  WHERE order_reviews.id = p_review_id AND order_reviews.user_id = auth.uid();

  RETURN QUERY
  SELECT 
    r.id,
    r.order_id,
    r.user_id,
    r.rating,
    r.review,
    r.created_at
  FROM order_reviews r
  WHERE r.id = p_review_id AND r.user_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_order_review(p_review_id uuid, p_rating integer, p_comment text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_review(p_review_id uuid, p_rating integer, p_comment text) TO authenticated;
