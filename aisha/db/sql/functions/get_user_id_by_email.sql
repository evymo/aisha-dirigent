-- Helper for intranet gateway token exchange.
-- Returns the user UUID for a given email. Service-role only.
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN (SELECT id FROM auth.users WHERE email = p_email LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_id_by_email(text) TO service_role;
