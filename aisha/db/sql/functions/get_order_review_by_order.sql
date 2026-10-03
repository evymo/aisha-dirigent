-- Function: public.get_order_review_by_order
-- Arguments: p_order_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:08+01:00

CREATE OR REPLACE FUNCTION public.get_order_review_by_order(p_order_id uuid)
 RETURNS TABLE(id uuid, order_id uuid, user_id uuid, rating integer, comment text, created_at timestamptz)
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
    r.order_id,
    r.user_id,
    r.rating,
    r.comment,
    r.created_at
  FROM order_reviews r
  WHERE r.order_id = p_order_id AND r.user_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_order_review_by_order(p_order_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_review_by_order(p_order_id uuid) TO authenticated;
