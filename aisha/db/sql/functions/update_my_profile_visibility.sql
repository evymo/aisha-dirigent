-- Function: public.update_my_profile_visibility
-- Arguments: p_is_public_profile boolean, p_show_in_leaderboard boolean, p_nickname text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:20+01:00

CREATE OR REPLACE FUNCTION public.update_my_profile_visibility(p_is_public_profile boolean DEFAULT NULL::boolean, p_show_in_leaderboard boolean DEFAULT NULL::boolean, p_nickname text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
    v_result jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    
    UPDATE profiles SET
        is_public_profile = COALESCE(p_is_public_profile, is_public_profile),
        show_in_leaderboard = COALESCE(p_show_in_leaderboard, show_in_leaderboard),
        nickname = CASE 
            WHEN p_nickname IS NOT NULL THEN NULLIF(trim(p_nickname), '')
            ELSE nickname
        END,
        updated_at = now()
    WHERE user_id = v_user_id;
    
    -- Return updated values
    SELECT jsonb_build_object(
        'is_public_profile', p.is_public_profile,
        'show_in_leaderboard', p.show_in_leaderboard,
        'nickname', p.nickname,
        'display_name_public', format_display_name_for_public(p.display_name, p.nickname, p.is_public_profile)
    ) INTO v_result
    FROM profiles p
    WHERE p.user_id = v_user_id;
    
    -- Audit log
    PERFORM public.write_audit_journal(
        p_action_type := 'update'::journal_action_type,
        p_area := 'member'::journal_area,
        p_details := jsonb_build_object('is_public', p_is_public_profile, 'show_leaderboard', p_show_in_leaderboard),
        p_entity_id := v_user_id::text,
        p_entity_type := 'profile_visibility',
        p_severity := NULL,
        p_summary := 'Profile visibility updated',
    p_user_id := v_user_id
  );
    
    RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_profile_visibility(p_is_public_profile boolean, p_show_in_leaderboard boolean, p_nickname text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile_visibility(p_is_public_profile boolean, p_show_in_leaderboard boolean, p_nickname text) TO authenticated;
