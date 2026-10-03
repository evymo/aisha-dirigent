-- Function: public.update_my_storyloop_ui_preferences
-- Arguments: p_storyloop_settings jsonb, p_sync_enabled boolean
-- Description: Updates the current user's StoryLoop UI personalization settings.
-- Security: SECURITY DEFINER (authenticated only)

CREATE OR REPLACE FUNCTION public.update_my_storyloop_ui_preferences(
  p_storyloop_settings jsonb DEFAULT NULL,
  p_sync_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_row public.user_ui_preferences%ROWTYPE;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_storyloop_settings IS NOT NULL AND jsonb_typeof(p_storyloop_settings) <> 'object' THEN
    RAISE EXCEPTION 'Invalid storyloop settings payload' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_ui_preferences (
    user_id,
    sync_enabled,
    storyloop_settings,
    updated_at
  )
  VALUES (
    v_user_id,
    COALESCE(p_sync_enabled, false),
    COALESCE(p_storyloop_settings, '{}'::jsonb),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    sync_enabled = COALESCE(p_sync_enabled, public.user_ui_preferences.sync_enabled),
    storyloop_settings = CASE
      WHEN p_storyloop_settings IS NULL THEN public.user_ui_preferences.storyloop_settings
      ELSE COALESCE(public.user_ui_preferences.storyloop_settings, '{}'::jsonb) || p_storyloop_settings
    END,
    updated_at = now()
  RETURNING *
  INTO v_row;

  RETURN jsonb_build_object(
    'sync_enabled', v_row.sync_enabled,
    'storyloop_settings', COALESCE(v_row.storyloop_settings, '{}'::jsonb)
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_storyloop_ui_preferences(jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_storyloop_ui_preferences(jsonb, boolean) TO authenticated;
