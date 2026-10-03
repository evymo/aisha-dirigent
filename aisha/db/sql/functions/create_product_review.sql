-- Function: public.create_product_review
-- Arguments: p_product_id uuid, p_rating integer, p_title text, p_review text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:09+01:00

CREATE OR REPLACE FUNCTION public.create_product_review(p_product_id uuid, p_rating integer, p_title text DEFAULT NULL::text, p_review text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_review_id UUID;
BEGIN
  INSERT INTO product_reviews (product_id, user_id, rating, title, review, is_verified_purchase)
  VALUES (p_product_id, auth.uid(), p_rating, p_title, p_review, true)
  RETURNING id INTO v_review_id;
  
  RETURN v_review_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_product_review(p_product_id uuid, p_rating integer, p_title text, p_review text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_product_review(p_product_id uuid, p_rating integer, p_title text, p_review text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_product_review(p_product_id uuid, p_rating integer, p_title text, p_review text) TO authenticated;
