-- Function: public.get_my_production_tokens
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:02+01:00

CREATE OR REPLACE FUNCTION public.get_my_production_tokens()
 RETURNS TABLE(id uuid, user_id uuid, token_count integer, expires_at timestamptz, source text, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    pt.id, pt.user_id, pt.token_count,
    pt.expires_at, pt.source, pt.created_at
  FROM production_tokens pt
  WHERE pt.user_id = auth.uid()
    AND (pt.expires_at IS NULL OR pt.expires_at > NOW())
  ORDER BY pt.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_production_tokens() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_production_tokens() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_production_tokens() TO authenticated;
