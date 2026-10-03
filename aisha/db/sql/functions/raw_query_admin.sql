-- raw_query_admin: Execute parameterized SQL from edge functions (admin only)
-- Called by: github-webhook-bridge/index.ts for upsert operations
-- SECURITY: service_role only — this is a powerful function, restrict carefully
CREATE OR REPLACE FUNCTION public.raw_query_admin(
  p_sql text,
  p_params text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Only service_role can call this (enforced by GRANT)
  EXECUTE p_sql USING
    p_params[1], p_params[2], p_params[3], p_params[4], p_params[5],
    p_params[6], p_params[7], p_params[8], p_params[9], p_params[10];
END;
$$;

REVOKE ALL ON FUNCTION public.raw_query_admin(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raw_query_admin(text, text[]) TO service_role;

COMMENT ON FUNCTION public.raw_query_admin(text, text[]) IS
  'Execute parameterized SQL from edge functions. RESTRICTED to service_role. Used by github-webhook-bridge for dynamic upserts.';
