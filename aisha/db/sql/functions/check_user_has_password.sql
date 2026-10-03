-- Function: public.check_user_has_password
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:58+01:00

CREATE OR REPLACE FUNCTION public.check_user_has_password(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_has_password BOOLEAN;
BEGIN
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    -- Fixed: Use user_id column (not id) to match profiles table schema
    SELECT NOT COALESCE(must_change_password, FALSE)
    INTO v_has_password
    FROM public.profiles
    WHERE user_id = v_user_id;

    RETURN COALESCE(v_has_password, FALSE);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_user_has_password(p_user_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_user_has_password(p_user_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_user_has_password(p_user_id uuid) TO authenticated;
