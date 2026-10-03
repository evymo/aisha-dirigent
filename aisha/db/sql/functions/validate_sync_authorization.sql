-- Function: public.validate_sync_authorization
-- Arguments: p_instance_id uuid, p_instance_token text, p_operation_type text, p_story_id uuid
-- Description: Core authorization logic for sync operations. Validates:
--   1. Instance exists and belongs to story
--   2. Instance is active
--   3. Token is valid (SHA-256 hash match), not revoked, not expired
--   4. Token has required scope for operation type ('sync:' || operation_type,
--      so 'promote' requires scope 'sync:promote')
--   5. Origin protection (export only from origin, no direct import into origin,
--      promote only FROM a non-origin replica towards the origin)
--   6. Flow direction compliance (blocked domains returned for caller to skip;
--      for 'promote' every domain whose flow_direction is not
--      'promote_on_approval' is blocked)
-- Security: SECURITY DEFINER — callable from other RPC functions

CREATE OR REPLACE FUNCTION public.validate_sync_authorization(
  p_instance_id uuid,
  p_instance_token text,
  p_operation_type text,
  p_story_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_token_hash text;
  v_token_record record;
  v_instance record;
  v_required_scope text;
  v_violations jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_instance
  FROM story_instances
  WHERE id = p_instance_id AND story_id = p_story_id;

  IF v_instance.id IS NULL THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Instance not found or does not belong to this story'
    );
  END IF;

  IF v_instance.status != 'active' THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Instance is not active (status: ' || v_instance.status || ')'
    );
  END IF;

  v_token_hash := encode(digest(p_instance_token, 'sha256'), 'hex');

  SELECT * INTO v_token_record
  FROM instance_auth_tokens
  WHERE instance_id = p_instance_id
    AND token_hash = v_token_hash
    AND revoked_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_token_record.id IS NULL THEN
    -- user_id = auth.uid() (nullable): sync auth runs under a token/service actor
    -- (auth.uid() NULL); the COALESCE fallback to '00000000-…0000' is not a real
    -- aisha_auth.users id → audit_journal_user_id_fkey violation on the failure
    -- path. NULL is FK-safe.
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'SYNC_AUTH_FAILED', jsonb_build_object(
      'area', 'story_sync', 'severity', 'warning',
      'instance_id', p_instance_id,
      'story_id', p_story_id,
      'operation_type', p_operation_type,
      'reason', 'invalid_token'
    ));
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Invalid or revoked token'
    );
  END IF;

  IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at < now() THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Token expired at ' || v_token_record.expires_at
    );
  END IF;

  v_required_scope := 'sync:' || p_operation_type;
  IF NOT (v_token_record.scopes ? v_required_scope) THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Token missing required scope: ' || v_required_scope,
      'token_scopes', v_token_record.scopes
    );
  END IF;

  IF p_operation_type = 'export' AND NOT v_instance.is_origin THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Only the origin instance can export bundles'
    );
  END IF;

  IF p_operation_type = 'import' AND v_instance.is_origin THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Cannot import directly into origin instance. Use promote operation for upstream changes.'
    );
  END IF;

  -- Promote is the upstream direction: a replica proposes changes to the origin.
  -- The origin never promotes to itself.
  IF p_operation_type = 'promote' AND v_instance.is_origin THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', 'Origin does not promote to itself'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'data_domain', sp.data_domain,
    'flow_direction', sp.flow_direction::text,
    'blocked', CASE
      WHEN p_operation_type = 'import' AND sp.flow_direction IN ('local_only', 'no_sync') THEN true
      WHEN p_operation_type = 'export' AND sp.flow_direction = 'local_only' THEN true
      -- Promote allows only domains explicitly opted into upstream flow
      WHEN p_operation_type = 'promote' AND sp.flow_direction <> 'promote_on_approval' THEN true
      ELSE false
    END
  ) ORDER BY sp.data_domain), '[]'::jsonb) INTO v_violations
  FROM story_sync_policies sp
  WHERE sp.story_id = p_story_id
    AND (
      (p_operation_type = 'import' AND sp.flow_direction IN ('local_only', 'no_sync'))
      OR (p_operation_type = 'export' AND sp.flow_direction = 'local_only')
      OR (p_operation_type = 'promote' AND sp.flow_direction <> 'promote_on_approval')
    );

  RETURN jsonb_build_object(
    'authorized', true,
    'instance_id', p_instance_id,
    'instance_type', v_instance.instance_type,
    'is_origin', v_instance.is_origin,
    'token_id', v_token_record.id,
    'scope_used', v_required_scope,
    'blocked_domains', v_violations,
    'note', CASE
      WHEN jsonb_array_length(v_violations) > 0
      THEN 'Some data domains are blocked by sync policies. They will be skipped during ' || p_operation_type || '.'
      ELSE 'All data domains allowed for ' || p_operation_type
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_sync_authorization(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_sync_authorization(uuid, text, text, uuid) TO authenticated;
