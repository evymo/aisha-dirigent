-- Function: public.create_order_review_full
-- Arguments: p_order_id uuid, p_rating integer, p_comment text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:07+01:00

CREATE OR REPLACE FUNCTION public.create_order_review_full(p_order_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_id uuid, user_id uuid, rating integer, review text, created_at timestamptz)
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

  IF NOT EXISTS (SELECT 1 FROM orders WHERE orders.id = p_order_id AND orders.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Order not found or access denied';
  END IF;

  INSERT INTO order_reviews (order_id, user_id, rating, review)
  VALUES (p_order_id, auth.uid(), p_rating, p_comment)
  RETURNING order_reviews.id INTO v_review_id;

  RETURN QUERY
  SELECT 
    r.id,
    r.order_id,
    r.user_id,
    r.rating,
    r.review,
    r.created_at
  FROM order_reviews r
  WHERE r.id = v_review_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_order_review_full(p_order_id uuid, p_rating integer, p_comment text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_review_full(p_order_id uuid, p_rating integer, p_comment text) TO authenticated;
