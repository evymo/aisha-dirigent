-- Function: public.get_my_profile_visibility
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:03+01:00

CREATE OR REPLACE FUNCTION public.get_my_profile_visibility()
 RETURNS TABLE(nickname text, is_public_profile boolean, show_in_leaderboard boolean, display_name_public text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- Audit log for profile access
    PERFORM public.write_audit_journal(
        p_action_type := 'view',
        p_area := 'member',
        p_details := NULL,
        p_entity_id := NULL,
        p_entity_type := 'profiles',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'notice',
        p_summary := 'Member viewing profile visibility settings',
        p_tags := ARRAY['phi','member','profile'],
        p_user_id := v_user_id
    );
    
    RETURN QUERY
    SELECT 
        p.nickname,
        p.is_public_profile,
        p.show_in_leaderboard,
        format_display_name_for_public(p.display_name, p.nickname, p.is_public_profile)
    FROM profiles p
    WHERE p.user_id = v_user_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_profile_visibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile_visibility() TO authenticated;
