-- Function: public.get_product_reviews_with_stats
-- Arguments: p_product_slug text
-- Description: Get product reviews with stats (public ratings)
-- Security: SECURITY DEFINER - public reviews are visible to everyone, names anonymized
-- @security: public
-- @audit: false (public ratings, not sensitive data)

CREATE OR REPLACE FUNCTION public.get_product_reviews_with_stats(p_product_slug text)
 RETURNS TABLE(review_id uuid, rating integer, comment text, created_at timestamptz, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
STABLE
AS $function$
BEGIN
  -- Public access - product reviews are public information
  -- Names are anonymized for privacy

  RETURN QUERY
  SELECT 
    pr.id as review_id,
    pr.rating,
    pr.comment,
    pr.created_at,
    -- Anonymize display names for privacy (show only first letter)
    CASE 
      WHEN p.display_name IS NOT NULL AND LENGTH(p.display_name) > 0 THEN 
        SUBSTRING(p.display_name FROM 1 FOR 1) || '***'
      ELSE 'Anonymous'
    END::text as display_name
  FROM product_reviews pr
  JOIN products prod ON prod.id = pr.product_id
  LEFT JOIN profiles p ON p.user_id = pr.user_id
  WHERE prod.slug = p_product_slug
  ORDER BY pr.created_at DESC;
END;
$function$
;

-- Permissions (PUBLIC: product reviews are public)
REVOKE ALL ON FUNCTION public.get_product_reviews_with_stats(p_product_slug text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_reviews_with_stats(p_product_slug text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_product_reviews_with_stats(p_product_slug text) TO authenticated;
