-- Function: public.revoke_instance_auth_token
-- Arguments: p_token_id uuid
-- Description: Soft-revokes an instance auth token. Sets revoked_at timestamp.
-- Security: SECURITY DEFINER — admin/staff only

CREATE OR REPLACE FUNCTION public.revoke_instance_auth_token(p_token_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_token record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  SELECT * INTO v_token
  FROM instance_auth_tokens WHERE id = p_token_id;

  IF v_token.id IS NULL THEN
    RAISE EXCEPTION 'Token not found: %', p_token_id;
  END IF;

  IF v_token.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_revoked', 'revoked_at', v_token.revoked_at);
  END IF;

  UPDATE instance_auth_tokens SET
    revoked_at = now(), updated_at = now()
  WHERE id = p_token_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'INSTANCE_TOKEN_REVOKE', jsonb_build_object(
    'area', 'story_sync', 'severity', 'warning',
    'entity_type', 'instance_auth_token', 'entity_id', p_token_id,
    'instance_id', v_token.instance_id
  ));

  RETURN jsonb_build_object('status', 'revoked', 'token_id', p_token_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_instance_auth_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_instance_auth_token(uuid) TO authenticated;
