-- Function: public.use_invitation
-- Arguments: p_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:35+01:00

CREATE OR REPLACE FUNCTION public.use_invitation(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT * INTO v_invitation FROM invitations
  WHERE code = p_code AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_uses IS NULL OR used_count < max_uses);
    
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired invitation');
  END IF;
  
  UPDATE invitations SET used_count = used_count + 1 WHERE id = v_invitation.id;
  
  IF v_invitation.role IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (auth.uid(), v_invitation.role::user_role)
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN jsonb_build_object('success', true, 'study_id', v_invitation.study_id, 'role', v_invitation.role);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.use_invitation(p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.use_invitation(p_code text) TO authenticated;
