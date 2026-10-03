-- Function: public.get_my_achievements
-- Arguments: p_locale TEXT (optional, defaults to 'en')
-- Description: Returns user achievements with localized titles and descriptions.
--              Falls back to English if translation not found.
-- Security: SECURITY DEFINER - runs with owner privileges.
-- Updated: 2026-01-25

CREATE OR REPLACE FUNCTION public.get_my_achievements(
  p_locale TEXT DEFAULT 'en'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_locale TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate locale (supported: cs, de, en, fr, ru, th)
  v_locale := CASE
    WHEN p_locale IN ('cs', 'de', 'en', 'fr', 'ru', 'th') THEN p_locale
    ELSE 'en'
  END;

  -- First check for new achievements
  PERFORM check_user_achievements(v_user_id);

  RETURN jsonb_build_object(
    'unlocked', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'code', a.code,
        'name', public.get_translation_value_with_fallback(
          a.title_key, 'achievements', v_locale, 'en', a.title
        ),
        'description', public.get_translation_value_with_fallback(
          a.description_key, 'achievements', v_locale, 'en', a.description
        ),
        'icon', a.icon,
        'category', a.category,
        'points_reward', a.points_reward,
        'is_unlocked', true,
        'unlocked_at', ua.unlocked_at
      ) ORDER BY ua.unlocked_at DESC)
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ua.user_id = v_user_id
    ),
    'available', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'code', a.code,
        'name', public.get_translation_value_with_fallback(
          a.title_key, 'achievements', v_locale, 'en', a.title
        ),
        'description', public.get_translation_value_with_fallback(
          a.description_key, 'achievements', v_locale, 'en', a.description
        ),
        'icon', a.icon,
        'category', a.category,
        'points_reward', a.points_reward,
        'is_unlocked', false,
        'unlocked_at', NULL,
        'requirement_type', a.requirement_type,
        'requirement_value', a.requirement_value
      ) ORDER BY a.requirement_value)
      FROM achievements a
      WHERE a.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM user_achievements ua
          WHERE ua.user_id = v_user_id AND ua.achievement_id = a.id
        )
    )
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_achievements(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_achievements(TEXT) TO authenticated;
