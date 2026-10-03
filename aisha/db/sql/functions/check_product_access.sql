-- Function: public.check_product_access
-- Arguments: p_product_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:57+01:00

CREATE OR REPLACE FUNCTION public.check_product_access(p_product_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM product_access
    WHERE user_id = auth.uid()
      AND product_id = p_product_id
      AND (expires_at IS NULL OR expires_at > NOW())
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_product_access(p_product_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_product_access(p_product_id uuid) FROM anon;
-- No GRANT - internal/helper function
