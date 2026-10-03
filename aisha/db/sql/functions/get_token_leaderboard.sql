-- Function: public.get_token_leaderboard
-- Arguments: p_token_type text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:41+01:00

CREATE OR REPLACE FUNCTION public.get_token_leaderboard(p_token_type text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(rank integer, display_name text, avatar_url text, total_tokens integer, governance_tokens integer, impact_tokens integer, data_tokens integer, is_current_user boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_rank INTEGER;
BEGIN
    -- Audit log for leaderboard access (profile data)
    IF v_user_id IS NOT NULL THEN
      PERFORM public.write_audit_journal(
          p_action_type := 'view',
          p_area := 'member',
          p_details := jsonb_build_object('token_type', p_token_type, 'limit', p_limit),
          p_entity_id := NULL,
          p_entity_type := 'profiles',
          p_new_values := NULL,
          p_old_values := NULL,
          p_severity := 'notice',
          p_summary := 'Viewing token leaderboard',
          p_tags := ARRAY['phi','member','leaderboard'],
          p_user_id := v_user_id
      );
    END IF;

    -- Return ranked members who opted into leaderboard
    RETURN QUERY
    WITH ranked AS (
        SELECT 
            p.user_id,
            format_display_name_for_public(p.display_name, p.nickname, p.is_public_profile) as formatted_name,
            p.avatar_url as user_avatar,
            (COALESCE(m.tokens_governance, 0) + COALESCE(m.tokens_impact, 0) + COALESCE(m.tokens_data, 0))::integer as total,
            COALESCE(m.tokens_governance, 0) as gov,
            COALESCE(m.tokens_impact, 0) as imp,
            COALESCE(m.tokens_data, 0) as dat,
            ROW_NUMBER() OVER (
                ORDER BY 
                    CASE 
                        WHEN p_token_type = 'governance' THEN COALESCE(m.tokens_governance, 0)
                        WHEN p_token_type = 'impact' THEN COALESCE(m.tokens_impact, 0)
                        WHEN p_token_type = 'data' THEN COALESCE(m.tokens_data, 0)
                        ELSE COALESCE(m.tokens_governance, 0) + COALESCE(m.tokens_impact, 0) + COALESCE(m.tokens_data, 0)
                    END DESC
            )::INTEGER as user_rank,
            p.user_id = v_user_id as is_self
        FROM profiles p
        LEFT JOIN memberships m ON m.user_id = p.user_id
        WHERE p.show_in_leaderboard = true
    )
    SELECT 
        r.user_rank,
        r.formatted_name,
        r.user_avatar,
        r.total,
        r.gov,
        r.imp,
        r.dat,
        r.is_self
    FROM ranked r
    WHERE r.user_rank <= p_limit
    ORDER BY r.user_rank;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_leaderboard(p_token_type text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_leaderboard(p_token_type text, p_limit integer) TO authenticated;
