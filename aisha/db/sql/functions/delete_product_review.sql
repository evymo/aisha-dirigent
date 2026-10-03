-- Function: public.delete_product_review
-- Arguments: p_review_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:24+01:00

CREATE OR REPLACE FUNCTION public.delete_product_review(p_review_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM product_reviews
  WHERE id = p_review_id AND user_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_product_review(p_review_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_product_review(p_review_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_product_review(p_review_id uuid) TO authenticated;
