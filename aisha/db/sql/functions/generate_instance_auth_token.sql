-- Function: public.generate_instance_auth_token
-- Arguments: p_expires_in_days integer, p_instance_id uuid, p_scopes jsonb, p_token_name text
-- Description: Generates a cryptographically secure auth token for an instance.
--              Returns plaintext ONCE — caller must store securely. Stores SHA-256 hash.
-- Security: SECURITY DEFINER — admin/staff only

CREATE OR REPLACE FUNCTION public.generate_instance_auth_token(
  p_expires_in_days integer DEFAULT 90,
  p_instance_id uuid DEFAULT NULL,
  p_scopes jsonb DEFAULT '["sync:import"]'::jsonb,
  p_token_name text DEFAULT 'default'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_instance record;
  v_raw_token text;
  v_token_hash text;
  v_token_id uuid;
  v_expires_at timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  SELECT * INTO v_instance
  FROM story_instances WHERE id = p_instance_id;

  IF v_instance.id IS NULL THEN
    RAISE EXCEPTION 'Instance not found: %', p_instance_id;
  END IF;

  v_raw_token := 'aisha_sync_' || encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  IF p_expires_in_days > 0 THEN
    v_expires_at := now() + (p_expires_in_days || ' days')::interval;
  ELSE
    v_expires_at := NULL;
  END IF;

  INSERT INTO instance_auth_tokens (
    instance_id, token_hash, token_name, scopes, expires_at, created_by
  ) VALUES (
    p_instance_id, v_token_hash, p_token_name, p_scopes, v_expires_at, v_user_id
  ) RETURNING id INTO v_token_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'INSTANCE_TOKEN_GENERATE', jsonb_build_object(
    'area', 'story_sync', 'severity', 'warning',
    'entity_type', 'instance_auth_token', 'entity_id', v_token_id,
    'instance_id', p_instance_id,
    'story_id', v_instance.story_id,
    'scopes', p_scopes,
    'token_name', p_token_name,
    'expires_at', v_expires_at
  ));

  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'token', v_raw_token,
    'instance_id', p_instance_id,
    'scopes', p_scopes,
    'expires_at', v_expires_at,
    'warning', 'Store this token securely. It will NOT be shown again.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_instance_auth_token(integer, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_instance_auth_token(integer, uuid, jsonb, text) TO authenticated;
