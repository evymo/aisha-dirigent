-- Function: public.get_my_activity_timeline
-- Purpose: Member activity timeline aggregating health check-ins, tokens, studies, dosing, documents
-- Access: Authenticated members only
-- Security: SECURITY DEFINER with audit logging, no sensitive data in output

CREATE OR REPLACE FUNCTION public.get_my_activity_timeline(p_limit integer DEFAULT 50)
 RETURNS TABLE(activity_type text, created_at timestamptz, description text, id uuid, title text, token_reward_amount numeric, token_reward_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('limit', p_limit),
      p_entity_id := NULL,
      p_entity_type := 'activity_timeline',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing activity timeline',
      p_tags := ARRAY['phi','member','timeline'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  (
    -- Health check-ins (no sensitive data notes!)
    SELECT 
      'health_checkin'::TEXT AS activity_type,
      hc.created_at,
      ''::TEXT AS description,
      hc.id,
      ('activity.health_checkin.' || hc.check_in_type::TEXT)::TEXT AS title,
      0::NUMERIC AS token_reward_amount,
      ''::TEXT AS token_reward_type
    FROM health_check_ins hc
    WHERE hc.user_id = v_user_id
    
    UNION ALL
    
    -- Token transactions (rewards earned — description is not sensitive data)
    SELECT 
      'token_earned'::TEXT AS activity_type,
      tt.created_at,
      COALESCE(tt.description, '') AS description,
      tt.id,
      ('activity.token_reward.' || tt.token_type)::TEXT AS title,
      tt.amount AS token_reward_amount,
      tt.token_type AS token_reward_type
    FROM token_transactions tt
    WHERE tt.user_id = v_user_id
      AND tt.transaction_type IN ('earned', 'reward', 'bonus')
    
    UNION ALL
    
    -- Study registrations (study description is public, not sensitive data)
    SELECT 
      'study_enrolled'::TEXT AS activity_type,
      se.enrolled_at AS created_at,
      ''::TEXT AS description,
      se.id,
      ('activity.study_enrolled')::TEXT AS title,
      0::NUMERIC AS token_reward_amount,
      ''::TEXT AS token_reward_type
    FROM study_registrations se
    LEFT JOIN studies s ON se.study_id = s.id
    WHERE se.user_id = v_user_id
    
    UNION ALL
    
    -- Dosing logs (no sensitive data notes!)
    SELECT 
      'dosing_logged'::TEXT AS activity_type,
      dl.logged_at AS created_at,
      ''::TEXT AS description,
      dl.id,
      'activity.dosing_logged'::TEXT AS title,
      0::NUMERIC AS token_reward_amount,
      ''::TEXT AS token_reward_type
    FROM dosing_logs dl
    WHERE dl.user_id = v_user_id
    
    UNION ALL
    
    -- Document uploads (no sensitive data description!)
    SELECT 
      'document_uploaded'::TEXT AS activity_type,
      mhd.created_at,
      ''::TEXT AS description,
      mhd.id,
      'activity.document_uploaded'::TEXT AS title,
      COALESCE(mhd.tokens_awarded, 0)::NUMERIC AS token_reward_amount,
      CASE WHEN mhd.tokens_awarded > 0 THEN 'data' ELSE '' END AS token_reward_type
    FROM member_health_documents mhd
    WHERE mhd.user_id = v_user_id
  )
  ORDER BY created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_activity_timeline(p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_activity_timeline(p_limit integer) TO authenticated;
