-- Function: public.check_and_award_achievements
-- Arguments: none (uses auth.uid() for current user)
-- Description: Wrapper function for mobile app - checks and awards achievements for current user
-- Security: SECURITY DEFINER - Only authenticated users can call this
-- Created: 2026-01-16

CREATE OR REPLACE FUNCTION public.check_and_award_achievements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSONB;
  v_new_achievements JSONB;
  v_awarded JSONB := '[]'::JSONB;
  v_achievement RECORD;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  -- Fail-closed: return empty if not authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('awarded', '[]'::JSONB);
  END IF;
  
  -- Call the internal check_user_achievements function
  v_result := check_user_achievements(v_user_id);
  
  -- Extract new achievements and transform to mobile app expected format
  v_new_achievements := v_result->'new_achievements';
  
  -- Transform to full achievement objects if any were awarded
  IF v_new_achievements IS NOT NULL AND jsonb_array_length(v_new_achievements) > 0 THEN
    FOR v_achievement IN
      SELECT a.*
      FROM achievements a
      WHERE a.id IN (
        SELECT (jsonb_array_elements(v_new_achievements)->>'id')::UUID
      )
    LOOP
      v_awarded := v_awarded || jsonb_build_object(
        'id', v_achievement.id,
        'code', v_achievement.code,
        'title', v_achievement.title,
        'description', v_achievement.description,
        'category', v_achievement.category,
        'icon', v_achievement.icon,
        'points_reward', v_achievement.points_reward,
        'is_unlocked', true,
        'unlocked_at', now()
      );
    END LOOP;
  END IF;
  
  RETURN jsonb_build_object('awarded', v_awarded);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_and_award_achievements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_award_achievements() TO authenticated;
