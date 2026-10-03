-- Function: public.update_my_profile_display_name
-- Arguments: p_display_name text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:20+01:00

CREATE OR REPLACE FUNCTION public.update_my_profile_display_name(p_display_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_old_display_name TEXT;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get current display name for audit
  SELECT display_name INTO v_old_display_name
  FROM profiles
  WHERE id = v_user_id;
  
  -- Update profile
  UPDATE profiles
  SET 
    display_name = COALESCE(p_display_name, display_name),
    updated_at = now()
  WHERE id = v_user_id;
  
  -- Create audit record
  INSERT INTO audit_journal (action, 
    user_id,
    action_type,
    area,
    entity_type,
    entity_id,
    summary,
    old_values,
    new_values,
    severity
  ) VALUES ('UPDATE_PROFILE_NAME', 
    v_user_id,
    'update',
    'member',
    'profile',
    v_user_id::TEXT,
    'Updated profile display name',
    jsonb_build_object('display_name', v_old_display_name),
    jsonb_build_object('display_name', p_display_name),
    'info'
  );
  
  RETURN TRUE;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_profile_display_name(p_display_name text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile_display_name(p_display_name text) TO authenticated;
