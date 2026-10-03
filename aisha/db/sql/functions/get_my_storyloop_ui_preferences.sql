-- Function: public.get_my_storyloop_ui_preferences
-- Arguments: (none)
-- Description: Returns the current user's StoryLoop UI personalization settings.
-- Security: SECURITY DEFINER (authenticated only)

CREATE OR REPLACE FUNCTION public.get_my_storyloop_ui_preferences()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_row record;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT
    uip.id,
    uip.sync_enabled,
    uip.storyloop_settings
  INTO v_row
  FROM public.user_ui_preferences uip
  WHERE uip.user_id = v_user_id;

  IF v_row.id IS NULL THEN
    INSERT INTO public.user_ui_preferences (user_id)
    VALUES (v_user_id)
    RETURNING id, sync_enabled, storyloop_settings INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'sync_enabled', v_row.sync_enabled,
    'storyloop_settings', COALESCE(v_row.storyloop_settings, '{}'::jsonb)
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_storyloop_ui_preferences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_storyloop_ui_preferences() TO authenticated;
