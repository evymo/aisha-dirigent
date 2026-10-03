-- Function: get_jwt_role
-- Returns the JWT role claim from the current request context.
-- Compatible with both PostgREST <12 (request.jwt.claim.role)
-- and PostgREST 14+ (request.jwt.claims JSON object).

CREATE OR REPLACE FUNCTION public.get_jwt_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );
$$;

REVOKE ALL ON FUNCTION get_jwt_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_jwt_role() TO anon, authenticated, service_role;
