-- Function: public.get_my_product_access
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:01+01:00

CREATE OR REPLACE FUNCTION public.get_my_product_access()
 RETURNS TABLE(id uuid, user_id uuid, product_id uuid, access_type text, granted_at timestamptz, expires_at timestamptz, granted_by uuid, notes text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    pa.id, pa.user_id, pa.product_id, pa.access_type,
    pa.granted_at, pa.expires_at, pa.granted_by, pa.notes
  FROM product_access pa
  WHERE pa.user_id = auth.uid()
    AND (pa.expires_at IS NULL OR pa.expires_at > NOW())
  ORDER BY pa.granted_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_product_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_product_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_product_access() TO authenticated;
