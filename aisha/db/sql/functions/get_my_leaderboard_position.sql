-- Function: public.get_my_leaderboard_position
-- Arguments: p_token_type text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:58+01:00

CREATE OR REPLACE FUNCTION public.get_my_leaderboard_position(p_token_type text DEFAULT NULL::text)
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
        RETURN NULL;
    END IF;

    -- Audit log for leaderboard position (includes profile data)
    PERFORM public.write_audit_journal(
        p_action_type := 'view',
        p_area := 'member',
        p_details := jsonb_build_object('token_type', p_token_type),
        p_entity_id := NULL,
        p_entity_type := 'profiles',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'notice',
        p_summary := 'Member viewing leaderboard position',
        p_tags := ARRAY['phi','member','leaderboard'],
        p_user_id := v_user_id
    );
    
    WITH all_ranked AS (
        SELECT 
            p.user_id,
            COALESCE(m.tokens_governance, 0) + COALESCE(m.tokens_impact, 0) + COALESCE(m.tokens_data, 0) as total,
            COALESCE(m.tokens_governance, 0) as gov,
            COALESCE(m.tokens_impact, 0) as imp,
            COALESCE(m.tokens_data, 0) as dat,
            p.show_in_leaderboard,
            ROW_NUMBER() OVER (
                ORDER BY 
                    CASE 
                        WHEN p_token_type = 'governance' THEN COALESCE(m.tokens_governance, 0)
                        WHEN p_token_type = 'impact' THEN COALESCE(m.tokens_impact, 0)
                        WHEN p_token_type = 'data' THEN COALESCE(m.tokens_data, 0)
                        ELSE COALESCE(m.tokens_governance, 0) + COALESCE(m.tokens_impact, 0) + COALESCE(m.tokens_data, 0)
                    END DESC
            )::INTEGER as global_rank
        FROM profiles p
        LEFT JOIN memberships m ON m.user_id = p.user_id
    ),
    leaderboard_ranked AS (
        SELECT 
            user_id,
            ROW_NUMBER() OVER (
                ORDER BY 
                    CASE 
                        WHEN p_token_type = 'governance' THEN gov
                        WHEN p_token_type = 'impact' THEN imp
                        WHEN p_token_type = 'data' THEN dat
                        ELSE total
                    END DESC
            )::INTEGER as leaderboard_rank
        FROM all_ranked
        WHERE show_in_leaderboard = true
    )
    SELECT jsonb_build_object(
        'global_rank', ar.global_rank,
        'leaderboard_rank', lr.leaderboard_rank,
        'total_tokens', ar.total,
        'governance_tokens', ar.gov,
        'impact_tokens', ar.imp,
        'data_tokens', ar.dat,
        'is_in_leaderboard', ar.show_in_leaderboard,
        'total_participants', (SELECT COUNT(*) FROM profiles WHERE show_in_leaderboard = true)
    ) INTO v_result
    FROM all_ranked ar
    LEFT JOIN leaderboard_ranked lr ON lr.user_id = ar.user_id
    WHERE ar.user_id = v_user_id;
    
    RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_leaderboard_position(p_token_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_leaderboard_position(p_token_type text) TO authenticated;
